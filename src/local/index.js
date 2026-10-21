import { App as CapApp } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { supabase } from '../lib/supabase'
import { openLocalDb, wipeLocalDb } from './db.js'
import { createRepo } from './repo.js'
import { createSyncer, failedRows, pendingCounts } from './sync.js'
import { createSupabaseRemote } from './remote.supabase.js'

const WRITES = ['addShop', 'saveProduct', 'deleteProduct', 'createSale', 'createPayment', 'createCompanyPayment', 'createReceipt']

let current = null // { userId, repo, syncer, driver }

// Screens import `repo` and call it like a normal object; it forwards to whatever is started.
export const repo = new Proxy({}, {
  get: (_, name) => {
    if (!current) throw new Error('Local database is not started')
    return current.repo[name]
  },
})
export const getSyncer = () => current?.syncer
export const getFailedRows = () => (current ? failedRows(current.driver) : [])

// Open the phone's database for this user. Returns { firstSyncDone }.
export async function startLocal(userId) {
  if (current?.userId === userId) return { firstSyncDone: current.driver.meta('initial_sync_done') === '1' }

  let driver = await openLocalDb()
  const owner = driver.meta('user_id')
  if (owner && owner !== userId) {
    if (pendingCounts(driver).pending > 0) {
      throw new Error('This phone still has unsent data from another account. Sign back in to that account and sync first.')
    }
    await wipeLocalDb()
    driver = await openLocalDb()
  }
  driver.setMeta('user_id', userId)
  await driver.persist()

  const repoImpl = createRepo(driver)
  // The Network plugin is the phone's own idea of "connected" (in a browser it reads navigator.onLine).
  let connected = (await Network.getStatus()).connected
  const syncer = createSyncer(driver, createSupabaseRemote(supabase), { isOnline: () => connected })

  // after every save: update the "waiting" count and try to send soon
  let timer = null
  const queueSync = () => {
    clearTimeout(timer)
    timer = setTimeout(() => syncer.syncNow(), 800)
  }
  for (const name of WRITES) {
    const original = repoImpl[name]
    repoImpl[name] = async (...args) => {
      const result = await original(...args)
      syncer.refresh()
      queueSync()
      return result
    }
  }
  Network.addListener('networkStatusChange', (s) => {
    connected = s.connected
    if (connected) syncer.syncNow()
    else syncer.refresh()
  })
  CapApp.addListener('resume', () => syncer.syncNow()) // app brought back to the front
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncer.syncNow()
  })

  current = { userId, repo: repoImpl, syncer, driver }
  syncer.refresh()
  const firstSyncDone = driver.meta('initial_sync_done') === '1'
  // opened with unsent entries on the phone: send them now (the very first sync is run by the app)
  if (firstSyncDone) syncer.syncNow()
  return { firstSyncDone }
}

// The very first sync downloads the account's data. Needs internet once.
export async function runFirstSync() {
  await current.syncer.syncNow()
  const ok = current.syncer.status.state === 'idle'
  if (ok) {
    current.driver.setMeta('initial_sync_done', '1')
    await current.driver.persist()
  }
  return { ok, error: current.syncer.status.error }
}
