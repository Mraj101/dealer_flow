import { MIGRATIONS } from './schema.js'

// Thin wrapper over a sql.js Database. Everything is synchronous (so a transaction can't
// interleave with another), and persist() writes the file to storage after each commit.
export function makeDriver(db, persistBytes) {
  let saving = Promise.resolve()

  const driver = {
    all(sql, params = []) {
      const stmt = db.prepare(sql)
      try {
        stmt.bind(params)
        const rows = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        return rows
      } finally {
        stmt.free()
      }
    },
    get(sql, params = []) {
      return driver.all(sql, params)[0]
    },
    run(sql, params = []) {
      db.run(sql, params)
    },
    // fn must be synchronous. Throwing rolls everything back.
    transaction(fn) {
      db.run('begin')
      try {
        const result = fn()
        db.run('commit')
        return result
      } catch (e) {
        db.run('rollback')
        throw e
      }
    },
    // Save the database file; writes are queued so they land in order.
    persist() {
      if (!persistBytes) return Promise.resolve()
      saving = saving.then(() => persistBytes(db.export()))
      return saving
    },
    meta(key) {
      return driver.get('select value from _meta where key = ?', [key])?.value ?? null
    },
    setMeta(key, value) {
      driver.run('insert into _meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
        [key, value === null ? null : String(value)])
    },
  }
  return driver
}

// Create tables on first run, apply newer migrations later (PRAGMA user_version).
export function migrate(db) {
  const version = db.exec('pragma user_version')[0].values[0][0]
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.run('begin')
    try {
      db.exec(MIGRATIONS[v])
      db.run(`pragma user_version = ${v + 1}`)
      db.run('commit')
    } catch (e) {
      db.run('rollback')
      throw e
    }
  }
}
