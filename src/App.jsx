import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { runFirstSync, startLocal } from './local'
import SyncBar from './components/SyncBar'
import Login from './screens/Login'
import RecordSale from './screens/RecordSale'
import AddShop from './screens/AddShop'
import Products from './screens/Products'
import DaySummary from './screens/DaySummary'
import Dues from './screens/Dues'
import Stock from './screens/Stock'

const TABS = [
  { id: 'sale', label: 'Sale', Screen: RecordSale },
  { id: 'day', label: 'Day', Screen: DaySummary },
  { id: 'dues', label: 'Dues', Screen: Dues },
  { id: 'stock', label: 'Stock', Screen: Stock },
  { id: 'shop', label: 'Shops', Screen: AddShop },
  { id: 'product', label: 'Products', Screen: Products },
]

// The signed-in user's id is remembered on the phone so the app can open with no internet.
const USER_KEY = 'dealer.user_id'
const remembered = () => { try { return localStorage.getItem(USER_KEY) } catch { return null } }
const remember = (id) => { try { id ? localStorage.setItem(USER_KEY, id) : localStorage.removeItem(USER_KEY) } catch { /* ignore */ } }

export default function App() {
  const [tab, setTab] = useState('sale')
  // loading | login | starting | firstSync | ready | error
  const [phase, setPhase] = useState('loading')
  const [problem, setProblem] = useState(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    let cancelled = false
    // An expired login can't refresh with no internet, and the sign-in library keeps retrying for
    // ~30 seconds. Don't make the user wait: with a remembered account, open after a moment.
    const known = remembered()
    const slow = known ? setTimeout(() => { if (!cancelled) setUserId(known) }, navigator.onLine ? 1500 : 0) : null
    supabase.auth.getSession().then(({ data, error }) => {
      clearTimeout(slow)
      if (cancelled) return
      if (data.session) return setUserId(data.session.user.id)
      const offline = !navigator.onLine || error?.name === 'AuthRetryableFetchError'
      if (offline && known) return setUserId(known)
      setPhase('login')
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT') { remember(null); setUserId(null); setPhase('login') }
      else if (s?.user) setUserId(s.user.id)
    })
    return () => { cancelled = true; clearTimeout(slow); data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!userId) return
    remember(userId)
    let cancelled = false
    setPhase('starting')
    ;(async () => {
      try {
        const { firstSyncDone } = await startLocal(userId)
        if (cancelled) return
        if (firstSyncDone) return setPhase('ready')
        setPhase('firstSync')
        const r = await runFirstSync()
        if (cancelled) return
        if (r.ok) setPhase('ready')
        else { setProblem(r.error || 'Could not download your data'); setPhase('error') }
      } catch (e) {
        if (!cancelled) { setProblem(e.message); setPhase('error') }
      }
    })()
    return () => { cancelled = true }
  }, [userId])

  const retry = () => { const id = userId; setUserId(null); setTimeout(() => setUserId(id), 0) }

  if (phase === 'loading') return null
  if (phase === 'login') return <Login />
  if (phase === 'starting' || phase === 'firstSync') {
    return (
      <div className="mx-auto min-h-screen max-w-md p-4 pt-24 text-center text-gray-600">
        {phase === 'starting' ? 'Opening…' : 'Loading your data…'}
      </div>
    )
  }
  if (phase === 'error') {
    return (
      <div className="mx-auto min-h-screen max-w-md space-y-4 p-4 pt-24 text-center">
        <p className="text-red-600">{problem}</p>
        <p className="text-sm text-gray-600">
          The first time, the app needs internet to load your data. After that it works offline.
        </p>
        <button onClick={retry} className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white">Try again</button>
      </div>
    )
  }

  const { Screen } = TABS.find((t) => t.id === tab)

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-50 pb-24 pt-[env(safe-area-inset-top)]">
      <main className="p-4">
        <SyncBar />
        <Screen />
      </main>
      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md border-t bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-4 text-xs font-medium ${
              tab === t.id ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex-1 py-4 text-xs font-medium text-gray-500"
        >
          Sign out
        </button>
      </nav>
    </div>
  )
}
