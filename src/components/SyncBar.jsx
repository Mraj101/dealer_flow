import { useEffect, useState } from 'react'
import { getFailedRows, getSyncer } from '../local'

// One line at the top of every screen: are your entries safely on the server?
export default function SyncBar() {
  const syncer = getSyncer()
  const [status, setStatus] = useState(syncer.status)
  const [showFailed, setShowFailed] = useState(false)

  useEffect(() => syncer.subscribe(setStatus), [syncer])

  const { state, pending, failed } = status
  let text
  let tone = 'bg-gray-100 text-gray-700'
  if (failed > 0) {
    text = `${failed} could not be saved to the server`
    tone = 'bg-red-50 text-red-700'
  } else if (state === 'syncing') {
    text = 'Syncing…'
    tone = 'bg-blue-50 text-blue-700'
  } else if (state === 'offline') {
    text = pending > 0 ? `Offline · ${pending} waiting to sync` : 'Offline · all saved on this phone'
    tone = 'bg-amber-50 text-amber-800'
  } else if (state === 'error') {
    text = `Sync problem · ${pending} waiting`
    tone = 'bg-red-50 text-red-700'
  } else if (pending > 0) {
    text = `${pending} waiting to sync`
    tone = 'bg-amber-50 text-amber-800'
  } else {
    text = 'All synced'
    tone = 'bg-green-50 text-green-700'
  }

  return (
    <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span>{text}</span>
        <span className="flex shrink-0 gap-3">
          {failed > 0 && (
            <button onClick={() => setShowFailed((v) => !v)} className="underline">
              {showFailed ? 'Hide' : 'Details'}
            </button>
          )}
          {state !== 'syncing' && (
            <button onClick={() => syncer.syncNow()} className="underline">Sync now</button>
          )}
        </span>
      </div>
      {showFailed && failed > 0 && (
        <ul className="mt-2 space-y-1 border-t pt-2 text-xs">
          {getFailedRows().map((f) => (
            <li key={f.id}>{f.table}: {f.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
