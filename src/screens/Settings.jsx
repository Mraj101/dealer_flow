import { useEffect, useState } from 'react'
import { getSyncer } from '../local'
import { supabase } from '../lib/supabase'
import { ConfirmDialog, Icon } from '../components/ui'
import pkg from '../../package.json'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')

export default function Settings({ onSignOut }) {
  const syncer = getSyncer()
  const [status, setStatus] = useState(syncer.status)
  const [email, setEmail] = useState(null)
  const [asking, setAsking] = useState(false)

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
