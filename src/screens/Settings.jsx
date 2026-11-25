import { useEffect, useState } from 'react'
import { getSyncer } from '../local'
import { supabase } from '../lib/supabase'
import { ConfirmDialog, Icon } from '../components/ui'
import { Capacitor } from '@capacitor/core'
import { haptic, hapticStats } from '../lib/haptics'
import pkg from '../../package.json'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')

export default function Settings({ onSignOut }) {
  const syncer = getSyncer()
  const [status, setStatus] = useState(syncer.status)
  const [email, setEmail] = useState(null)
  const [asking, setAsking] = useState(false)
  const [buzzTest, setBuzzTest] = useState(null)
  const [stats, setStats] = useState({ ...hapticStats })
  // refresh the counters while this page is open
  useEffect(() => {
    const t = setInterval(() => setStats({ ...hapticStats }), 500)
    return () => clearInterval(t)
  }, [])

  // a long, easy-to-feel buzz, to find out whether this phone/browser vibrates at all
  const testVibration = () => {
    if (Capacitor.isNativePlatform()) {
      haptic.error()
      return setBuzzTest('Sent a vibration through the app. If you felt nothing, turn on touch vibration in the phone settings.')
    }
    if (!navigator.vibrate) return setBuzzTest('This browser cannot vibrate (iPhone Safari and computers can’t).')
    const accepted = navigator.vibrate(400)
    setBuzzTest(accepted
      ? 'Chrome accepted a 0.4 second vibration. If you felt nothing, the phone is blocking it: turn off silent / do-not-disturb and turn on vibration in the phone settings.'
      : 'Chrome refused to vibrate. Tap the button again.')
  }

  useEffect(() => syncer.subscribe(setStatus), [syncer])
  useEffect(() => {
    // read from the phone's saved login; no internet needed
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user?.email ?? null)).catch(() => {})
  }, [])

  const offline = status.state === 'offline' || navigator.onLine === false

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border bg-white p-3">
        <h2 className="font-semibold">Sync</h2>
        <div className="space-y-1 text-sm text-gray-700">
          <div className="flex justify-between"><span>Waiting to sync</span><span>{status.pending}</span></div>
          <div className="flex justify-between">
            <span>Refused by the server</span>
            <span className={status.failed ? 'text-red-600' : ''}>{status.failed}</span>
          </div>
          <div className="flex justify-between"><span>Last synced</span><span>{when(status.lastSyncAt)}</span></div>
          <div className="flex justify-between"><span>Connection</span><span>{offline ? 'Offline' : 'Online'}</span></div>
        </div>
        <button type="button" onClick={() => syncer.syncNow()} disabled={status.state === 'syncing'}
          className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 font-medium text-blue-700 disabled:opacity-50">
          <Icon name="sync" /> {status.state === 'syncing' ? 'Syncing…' : 'Sync now'}
        </button>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-3">
        <h2 className="font-semibold">Account</h2>
        <p className="text-sm text-gray-700">Signed in as <b>{email ?? 'this phone’s account'}</b></p>
        <button type="button" onClick={() => setAsking(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2 font-medium text-red-600">
          <Icon name="signout" /> Sign out
        </button>
      </section>

      <section className="space-y-2 rounded-xl border bg-white p-3">
        <h2 className="font-semibold">Vibration</h2>
        <p className="text-sm text-gray-600">Taps, typing and saves make the phone vibrate a little.</p>
        <button type="button" onClick={testVibration}
          className="w-full rounded-lg border py-2 font-medium text-blue-700">Test vibration</button>
        {buzzTest && <p className="text-sm text-gray-700">{buzzTest}</p>}
        <div className="space-y-0.5 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
          <div className="font-medium text-gray-700">Since the app opened ({Capacitor.isNativePlatform() ? 'Android app' : 'browser'})</div>
          <div className="flex justify-between"><span>App asked to vibrate</span><span>{stats.asked}</span></div>
          <div className="flex justify-between"><span>Phone accepted</span><span>{stats.accepted}</span></div>
          <div className="flex justify-between"><span>Phone refused</span>
            <span className={stats.refused ? 'font-semibold text-red-600' : ''}>{stats.refused}</span></div>
          {stats.nativeFailed > 0 && (
            <div className="flex justify-between text-red-600"><span>Native haptics failed</span><span>{stats.nativeFailed}</span></div>
          )}
          {stats.last && <div>Last: {stats.last}</div>}
        </div>
      </section>

      <section className="space-y-1 rounded-xl border bg-white p-3 text-sm text-gray-600">
        <h2 className="font-semibold text-gray-900">About</h2>
        <div className="flex justify-between"><span>App version</span><span>{pkg.version}</span></div>
        <p className="text-xs">Your data is kept on this phone and copied to the server when there is internet.</p>
      </section>

      {asking && (
        <ConfirmDialog title="Sign out?" danger yesLabel="Yes, sign out" noLabel="No, stay"
          onNo={() => setAsking(false)} onYes={() => { setAsking(false); onSignOut() }}>
          {status.pending > 0 && (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
              <b>{status.pending} entr{status.pending === 1 ? 'y is' : 'ies are'} not synced yet.</b> They stay on
              this phone and are sent after you sign back in with the same account.
            </p>
          )}
          {offline && (
            <p className="rounded-lg bg-red-50 p-2 text-red-800">
              <b>You are offline.</b> Signing back in needs internet, so you won’t be able to use the app
              until you are online again.
            </p>
          )}
          <p>You will need your email and password to sign in again.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
