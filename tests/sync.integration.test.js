// Runs the sync engine against a real Postgres that has supabase 01-09 applied.
// Skipped unless PG_TEST_URL is set, e.g. postgres://postgres@127.0.0.1:54329/t
import test, { before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { openTestDb, seedScenario, USER } from './helpers.js'
import { createPgRemote } from './pg-remote.js'
import { syncOnce, createSyncer, pendingCounts, failedRows } from '../src/local/sync.js'
import { TABLE_ORDER } from '../src/local/schema.js'

const URL = process.env.PG_TEST_URL
const opts = { skip: !URL && 'set PG_TEST_URL to run' }
let pool
before(() => { if (URL) pool = new pg.Pool({ connectionString: URL }) })
after(() => pool?.end())
beforeEach(async () => {
  if (!URL) return
  await pool.query(`truncate ${[...TABLE_ORDER].reverse().join(',')} cascade`)
})

const serverCounts = async () => {
  const out = []
  for (const t of ['products', 'shops', 'sales', 'sale_items', 'payments', 'company_payments', 'receipts', 'receipt_items']) {
    out.push(Number((await pool.query(`select count(*) c from ${t}`)).rows[0].c))
  }
  return out
}
const serverTotals = async () => {
  const s = (await pool.query(`select sum(paid_amount) paid, sum(cost) cost, sum(total) total, sum(due) due, sum(profit) profit from sales_summary`)).rows[0]
  const c = (await pool.query('select paid, charged, balance from company_balance')).rows[0]
  const bal = (await pool.query('select s.name, b.balance from shop_balances b join shops s on s.id = b.shop_id order by s.name')).rows
  const stock = (await pool.query('select p.name, st.received_pieces r, st.sold_pieces s from product_stock st join products p on p.id = st.product_id order by p.name')).rows
  return { s, c, bal, stock }
}
const localTotals = (repo) => {
  const all = [...repo.salesSummaryByDate('2026-10-19'), ...repo.salesSummaryByDate('2026-10-20')]
  const sum = (k) => Math.round(all.reduce((a, r) => a + (r[k] ?? 0), 0) * 100) / 100
  return { paid: sum('paid_amount'), cost: sum('cost'), total: sum('total'), due: sum('due'), profit: sum('profit') }
}
const asNumbers = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]))

test('offline work reaches the server, and server views agree with the phone', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  assert.equal(pendingCounts(driver).pending, 3 + 2 + 2 + 1 + 1 + 1) // 3 products,2 shops,2 sales,1 payment,1 company payment,1 receipt

  const remote = createPgRemote(pool, USER)
  const r = await syncOnce(driver, remote)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(await serverCounts(), [3, 2, 2, 3, 1, 1, 1, 2])
  assert.equal(pendingCounts(driver).pending, 0)

  const t = await serverTotals()
  assert.deepEqual(asNumbers(t.s), localTotals(repo))
  assert.deepEqual(asNumbers(t.c), repo.companyBalance())
  assert.deepEqual(t.bal.map((b) => [b.name, Number(b.balance)]), [['Alauddin', 100], ['Tista', 0]])
  assert.deepEqual(t.stock.map((s) => [s.name, s.r, s.s]), [['choco fun', 0, 60], ['cola', 238, 24], ['malai fun', 480, 48]])
})

test('buy prices keep 4 decimals through the round trip', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  await syncOnce(driver, createPgRemote(pool, USER))
  const row = (await pool.query("select unit_buy_price from products where name = 'malai fun'")).rows[0]
  assert.equal(row.unit_buy_price, '7.5416')
})

test('syncing again sends nothing and creates no duplicates', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  const remote = createPgRemote(pool, USER)
  await syncOnce(driver, remote)
  const r2 = await syncOnce(driver, remote)
  assert.equal(r2.pushed, 0)
  assert.deepEqual(await serverCounts(), [3, 2, 2, 3, 1, 1, 1, 2])
  // re-sending the same rows (e.g. the app died before it saw the reply) is harmless
  driver.run('update sales set _dirty = 1')
  driver.run('update sale_items set _dirty = 1')
  await syncOnce(driver, remote)
  assert.deepEqual(await serverCounts(), [3, 2, 2, 3, 1, 1, 1, 2])
})

test('a brand new phone gets the same data and the same totals', opts, async () => {
  const a = await openTestDb()
  await seedScenario(a.repo)
  await syncOnce(a.driver, createPgRemote(pool, USER))

  const b = await openTestDb()
  const r = await syncOnce(b.driver, createPgRemote(pool, USER))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(localTotals(b.repo), localTotals(a.repo))
  assert.deepEqual(b.repo.companyBalance(), a.repo.companyBalance())
  assert.deepEqual(b.repo.duesList(), a.repo.duesList())
  assert.deepEqual(b.repo.productStock().sort((x, y) => x.product_id.localeCompare(y.product_id)),
    a.repo.productStock().sort((x, y) => x.product_id.localeCompare(y.product_id)))
  assert.equal(pendingCounts(b.driver).pending, 0)
})

test('changes made on the server arrive on the phone; waiting local edits are not overwritten', opts, async () => {
  const { repo, driver } = await openTestDb()
  const ids = await seedScenario(repo)
  const remote = createPgRemote(pool, USER)
  await syncOnce(driver, remote)

  await pool.query("update products set unit_mrp = 99 where name = 'cola'")
  await pool.query("update products set name = 'server name' where name = 'choco fun'")
  // phone edits the same choco row while offline
  await repo.saveProduct({ id: ids.choco, name: 'phone name', pieces_per_carton: 48, unit_buy_price: 7.54, unit_mrp: 10 })

  await syncOnce(driver, remote)
  const prods = Object.fromEntries(repo.listProducts().map((p) => [p.id, p]))
  assert.equal(prods[ids.cola].unit_mrp, 99)          // pulled
  assert.equal(prods[ids.choco].name, 'phone name')   // phone's waiting edit won and was sent
  assert.equal((await pool.query("select name from products where id = $1", [ids.choco])).rows[0].name, 'phone name')
})

test('edits and soft deletes sync', opts, async () => {
  const { repo, driver } = await openTestDb()
  const ids = await seedScenario(repo)
  const remote = createPgRemote(pool, USER)
  await syncOnce(driver, remote)
  await repo.deleteProduct(ids.cola)
  await syncOnce(driver, remote)
  const row = (await pool.query('select deleted_at from products where id = $1', [ids.cola])).rows[0]
  assert.ok(row.deleted_at)
  assert.deepEqual(await serverCounts(), [3, 2, 2, 3, 1, 1, 1, 2]) // never hard deleted
})

test('one bad row is reported and does not block the others', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  // a sale whose paid amount is more than its bill (the server's check constraint refuses it)
  driver.run('update sales set paid_amount = 99999999, _dirty = 1, _ver = _ver + 1 where bill_amount = 5000000')
  const r = await syncOnce(driver, createPgRemote(pool, USER))
  assert.equal(r.errors.length >= 1, true)
  const bad = failedRows(driver)
  assert.ok(bad.some((f) => f.table === 'sales' && /sales_paid_le_bill/.test(f.message)))
  // its lines fail too (no parent on the server) but everything unrelated went through
  const counts = await serverCounts()
  assert.deepEqual(counts.slice(0, 2), [3, 2])  // products, shops
  assert.equal(counts[2], 1)                     // the good sale
  assert.equal(counts[4], 1)                     // the payment
  assert.equal(counts[6], 1)                     // the receipt
  assert.ok(pendingCounts(driver).failed >= 1)
})

test('a row the server refuses is retried once fixed', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  driver.run('update sales set paid_amount = 99999999, _dirty = 1, _ver = _ver + 1 where bill_amount = 5000000')
  const remote = createPgRemote(pool, USER)
  await syncOnce(driver, remote)
  driver.run('update sales set paid_amount = 5000000, _dirty = 1, _ver = _ver + 1, _error = null where bill_amount = 5000000')
  const r = await syncOnce(driver, remote)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(await serverCounts(), [3, 2, 2, 3, 1, 1, 1, 2])
  assert.equal(pendingCounts(driver).failed, 0)
})

test('row level security: rows for another user are refused', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  const other = '22222222-2222-2222-2222-222222222222'
  const r = await syncOnce(driver, createPgRemote(pool, other))
  assert.ok(r.errors.length > 0)
  assert.deepEqual(await serverCounts(), [0, 0, 0, 0, 0, 0, 0, 0])
})

test('fatal errors (offline) stop the sync and leave rows waiting, with no row blamed', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  const remote = createPgRemote(pool, USER, {
    onUpsert: () => { throw Object.assign(new Error('Failed to fetch'), { fatal: true }) },
  })
  await assert.rejects(syncOnce(driver, remote), /Failed to fetch/)
  assert.equal(pendingCounts(driver).failed, 0)
  assert.ok(pendingCounts(driver).pending > 0)
  assert.equal(remote.calls.upsert, 1) // gave up straight away, did not retry row by row
  // back online: everything goes through
  await syncOnce(driver, createPgRemote(pool, USER))
  assert.deepEqual(await serverCounts(), [3, 2, 2, 3, 1, 1, 1, 2])
})

test('a row edited while it is being sent stays waiting', opts, async () => {
  const { repo, driver } = await openTestDb()
  const ids = await seedScenario(repo)
  let edited = false
  const remote = createPgRemote(pool, USER, {
    onUpsert: async (table) => {
      if (table === 'products' && !edited) {
        edited = true
        await repo.saveProduct({ id: ids.cola, name: 'cola v2', pieces_per_carton: 24, unit_buy_price: 18, unit_mrp: 25 })
      }
    },
  })
  await syncOnce(driver, remote)
  assert.equal(driver.get('select _dirty from products where id = ?', [ids.cola])._dirty, 1)
  await syncOnce(driver, createPgRemote(pool, USER))
  assert.equal((await pool.query('select name from products where id = $1', [ids.cola])).rows[0].name, 'cola v2')
})

test('createSyncer: one at a time, status, and offline detection', opts, async () => {
  const { repo, driver } = await openTestDb()
  await seedScenario(repo)
  let online = false
  const remote = createPgRemote(pool, USER)
  const syncer = createSyncer(driver, remote, { isOnline: () => online })
  await syncer.syncNow()
  assert.equal(syncer.status.state, 'offline')
  assert.ok(syncer.status.pending > 0)
  assert.equal(remote.calls.upsert, 0)

  online = true
  await Promise.all([syncer.syncNow(), syncer.syncNow(), syncer.syncNow()])
  assert.equal(syncer.status.state, 'idle')
  assert.equal(syncer.status.pending, 0)
  assert.ok(syncer.status.lastSyncAt)
})
