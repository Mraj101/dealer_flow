// A tiny stand-in for Supabase (login + the bits of PostgREST that sync uses), kept in memory.
// The e2e build points at https://fake.supabase.test, so nothing can reach the real project.
import { TABLES } from '../../src/local/schema.js'

export const FAKE_URL = 'https://fake.supabase.test'
export const FAKE_USER = '33333333-3333-3333-3333-333333333333'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  sub: FAKE_USER, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
})}.sig`

export function createFakeServer() {
  const tables = Object.fromEntries(Object.keys(TABLES).map((t) => [t, new Map()]))
  const log = [] // every request, so tests can check what the app really sent
  let stamp = 0
  const state = { offline: false, restDown: false } // offline = no internet to Supabase at all
  const now = () => `2026-10-22T10:00:${String(Math.floor(stamp / 1000) % 60).padStart(2, '0')}.${String(stamp++ % 1000).padStart(3, '0')}000+00:00`

  // what PostgREST sends back: numeric columns as JSON numbers
  const out = (table, row) => {
    const r = { ...row }
    for (const [c, kind] of TABLES[table]) if (kind === 'money' && r[c] !== null && r[c] !== undefined) r[c] = Number(r[c])
    return r
  }

  async function handle(route) {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    if (state.offline || (state.restDown && path.startsWith('/rest/'))) return route.abort('internetdisconnected')
    const json = (status, body, headers = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) })

    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    }

    if (path === '/auth/v1/token') {
      const session = {
        access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'r', user: { id: FAKE_USER, aud: 'authenticated', role: 'authenticated', email: 'a@b.c' },
      }
      return json(200, session)
    }
    if (path === '/auth/v1/logout') return json(204, {})
    if (path === '/auth/v1/user') return json(200, { id: FAKE_USER, email: 'a@b.c' })

    const m = /^\/rest\/v1\/(\w+)$/.exec(path)
    if (!m || !tables[m[1]]) return json(404, { message: 'not found' })
    const table = m[1]

    if (req.method() === 'POST') {
      const rows = JSON.parse(req.postData())
      log.push({ method: 'POST', table, url: req.url(), prefer: req.headers().prefer, rows })
      for (const row of rows) {
        if (row.user_id !== FAKE_USER) return json(403, { code: '42501', message: 'row-level security' })
        tables[table].set(row.id, { ...(tables[table].get(row.id) || {}), ...row, updated_at: now() })
      }
      return json(201, null)
    }

    if (req.method() === 'GET') {
      log.push({ method: 'GET', table, url: req.url() })
      let rows = [...tables[table].values()].sort((a, b) =>
        a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : 1)
      const or = url.searchParams.get('or') // (updated_at.gt.T,and(updated_at.eq.T,id.gt.I))
      if (or) {
        const mm = /updated_at\.gt\.(.+?),and\(updated_at\.eq\.(.+?),id\.gt\.(.+?)\)/.exec(or)
        if (!mm) return json(400, { code: 'PGRST100', message: `bad or filter: ${or}` })
        const [, ts, , id] = mm
        rows = rows.filter((r) => r.updated_at > ts || (r.updated_at === ts && r.id > id))
      }
      rows = rows.slice(0, Number(url.searchParams.get('limit') || 1000))
      return json(200, rows.map((r) => out(table, r)))
    }
    return json(405, {})
  }

  return { tables, log, handle, state }
}
