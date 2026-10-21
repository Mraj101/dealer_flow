import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { makeDriver, migrate } from './driver.js'

// The database file lives in IndexedDB (the app's own private storage on Android).
// It is written after every save, so closing or killing the app loses nothing.
const IDB_NAME = 'dealer-local'
const STORE = 'kv'
const KEY = 'sqlite'

const idb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

async function idbDo(mode, fn) {
  const db = await idb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function openLocalDb() {
  // ask the browser not to clear our storage when the phone runs low on space
  try { await navigator.storage?.persist?.() } catch { /* not supported, fine */ }
  const SQL = await initSqlJs({ locateFile: () => wasmUrl })
  const saved = await idbDo('readonly', (s) => s.get(KEY))
  const db = saved ? new SQL.Database(saved) : new SQL.Database()
  migrate(db)
  const driver = makeDriver(db, (bytes) => idbDo('readwrite', (s) => s.put(bytes, KEY)))
  await driver.persist()
  return driver
}

export const wipeLocalDb = () => idbDo('readwrite', (s) => s.delete(KEY))
