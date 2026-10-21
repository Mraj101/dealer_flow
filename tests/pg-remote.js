import pg from 'pg'
import { TABLES } from '../src/local/schema.js'

// Return dates/timestamps as the strings PostgREST would give (ISO with "T").
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1184, (v) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))

// A "server" backed by real Postgres. Runs as the `authenticated` role with the user's id,
// so row level security and the table constraints apply exactly as they do on Supabase.
export function createPgRemote(pool, userId, { onUpsert } = {}) {
  const asUser = async (fn) => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role authenticated')
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
      const r = await fn(c)
      await c.query('commit')
      return r
    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }
  return {
    calls: { upsert: 0, selectSince: 0 },
    async upsert(table, rows) {
      this.calls.upsert++
      if (onUpsert) await onUpsert(table, rows)
      await asUser(async (c) => {
        for (const row of rows) {
          const cols = Object.keys(row)
          const sql = `insert into ${table} (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})
            on conflict (id) do update set ${cols.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ')}`
          await c.query(sql, cols.map((k) => row[k]))
        }
      })
    },
    async selectSince(table, cursor, limit) {
      this.calls.selectSince++
      return asUser(async (c) => {
        const q = cursor
          ? await c.query(`select * from ${table} where (updated_at, id) > ($1::timestamptz, $2::uuid) order by updated_at, id limit $3`,
              [cursor.ts, cursor.id, limit])
          : await c.query(`select * from ${table} order by updated_at, id limit $1`, [limit])
        return q.rows
      })
    },
  }
}
export { TABLES }
