import { TABLES, TABLE_ORDER } from './schema.js'
import { toUnits, toDecimalString } from './units.js'

// What counts as one "waiting" item in the app: top-level records (a sale and its lines count once).
const TOP_LEVEL = ['sales', 'payments', 'receipts', 'company_payments', 'shops', 'products']
const PAGE = 500

// ---------- phone row <-> server row ----------
// updated_at is not sent: the server stamps it, and the pull cursor relies on server time.
export function toRemoteRow(table, row) {
  const out = {}
  for (const [c, kind] of TABLES[table]) {
    if (c === 'updated_at') continue
    const v = row[c]
    out[c] = v === null || v === undefined ? null
      : kind === 'money' ? toDecimalString(v)
      : kind === 'bool' ? v === 1
      : v
  }
  return out
}

export function fromRemoteRow(table, r) {
  const out = {}
  for (const [c, kind] of TABLES[table]) {
    const v = r[c]
    out[c] = v === null || v === undefined ? null
      : kind === 'money' ? toUnits(v)
      : kind === 'bool' ? (v ? 1 : 0)
      : v
  }
  return out
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// remote = {
//   upsert(table, rows)                       // send rows; throw if the server refuses
//   selectSince(table, cursor | null, limit)  // rows ordered by (updated_at, id) after the cursor {ts, id}
// }
// An error with .fatal = true means "not this row's fault" (offline, login expired, server down):
// the whole sync stops and rows stay waiting. Any other error is recorded on that row.
export async function syncOnce(driver, remote) {
  const result = { pushed: 0, pulled: 0, errors: [] }

  // ----- push: parents before children -----
  for (const table of TABLE_ORDER) {
    const rows = driver.all(`select * from ${table} where _dirty = 1 order by created_at, rowid`)
    for (const chunk of chunks(rows, 200)) {
      const sent = await pushChunk(driver, remote, table, chunk, result)
      result.pushed += sent
    }
  }

  // ----- pull -----
  for (const table of TABLE_ORDER) {
    let cursor = JSON.parse(driver.meta(`cursor_${table}`) || 'null')
    for (;;) {
      const rows = await remote.selectSince(table, cursor, PAGE)
      driver.transaction(() => {
        for (const r of rows) {
          try {
            applyRemote(driver, table, r)
            result.pulled++
          } catch (e) {
            result.errors.push({ table, id: r.id, message: `pull: ${e.message}` })
          }
        }
      })
      if (rows.length) {
        const last = rows[rows.length - 1]
        cursor = { ts: last.updated_at, id: last.id }
        driver.setMeta(`cursor_${table}`, JSON.stringify(cursor))
      }
      if (rows.length < PAGE) break
    }
  }

  await driver.persist()
  return result
}

async function pushChunk(driver, remote, table, chunk, result) {
  const tryRows = async (rows) => {
    await remote.upsert(table, rows.map((r) => toRemoteRow(table, r)))
    driver.transaction(() => {
      for (const r of rows) {
        // only clean if the row wasn't edited while it was being sent
        driver.run(`update ${table} set _dirty = 0, _error = null where id = ? and _ver = ?`, [r.id, r._ver])
      }
    })
    return rows.length
  }
  try {
    return await tryRows(chunk)
  } catch (e) {
    if (e.fatal) throw e
    // the batch is refused as a whole: find which rows are the problem
    let sent = 0
    for (const r of chunk) {
      try {
        sent += await tryRows([r])
      } catch (e2) {
        if (e2.fatal) throw e2
        driver.run(`update ${table} set _error = ? where id = ?`, [e2.message, r.id])
        result.errors.push({ table, id: r.id, message: e2.message })
      }
    }
    return sent
  }
}

// Server version wins, unless the phone has a newer change waiting to be sent.
function applyRemote(driver, table, remoteRow) {
  const local = driver.get(`select _dirty from ${table} where id = ?`, [remoteRow.id])
  if (local && local._dirty === 1) return
  const row = fromRemoteRow(table, remoteRow)
  const cols = TABLES[table].map(([c]) => c)
  driver.run(
    `insert into ${table} (${cols.join(',')}, _dirty, _ver, _error)
     values (${cols.map(() => '?').join(',')}, 0, 0, null)
     on conflict(id) do update set ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')},
       _dirty = 0, _ver = 0, _error = null`,
    cols.map((c) => row[c])
  )
}

// ---------- status ----------
export function pendingCounts(driver) {
  let pending = 0
  for (const t of TOP_LEVEL) pending += driver.get(`select count(*) c from ${t} where _dirty = 1`).c
  let failed = 0
  for (const t of TABLE_ORDER) failed += driver.get(`select count(*) c from ${t} where _dirty = 1 and _error is not null`).c
  return { pending, failed }
}

export function failedRows(driver) {
  const out = []
  for (const t of TABLE_ORDER) {
    for (const r of driver.all(`select id, _error from ${t} where _dirty = 1 and _error is not null`)) {
      out.push({ table: t, id: r.id, message: r._error })
    }
  }
  return out
}

// One sync at a time; a request made during a sync runs again right after it.
export function createSyncer(driver, remote, { isOnline = () => true } = {}) {
  const listeners = new Set()
  let running = null
  let again = false
  let status = { state: 'idle', pending: 0, failed: 0, lastSyncAt: null, error: null }

  const set = (patch) => {
    status = { ...status, ...pendingCounts(driver), ...patch }
    listeners.forEach((fn) => fn(status))
  }

  const run = async () => {
    do {
      again = false
      if (!isOnline()) { set({ state: 'offline' }); return }
      set({ state: 'syncing', error: null })
      try {
        const r = await syncOnce(driver, remote)
        set({ state: 'idle', lastSyncAt: new Date().toISOString(), error: r.errors[0]?.message ?? null })
      } catch (e) {
        set({ state: e.fatal ? 'offline' : 'error', error: e.message })
        return
      }
    } while (again)
  }

  return {
    get status() { return status },
    subscribe(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn) },
    refresh() { set({}) },
    syncNow() {
      if (running) { again = true; return running }
      running = run().finally(() => { running = null })
      return running
    },
  }
}
