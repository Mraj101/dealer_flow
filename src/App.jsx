import { useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { supabase } from './lib/supabase'
import { runFirstSync, startLocal } from './local'
import SyncBar from './components/SyncBar'
import BottomBar from './components/BottomBar'
import { Icon } from './components/ui'
import Login from './screens/Login'
import Home from './screens/Home'
import RecordSale from './screens/RecordSale'
import DaySummary from './screens/DaySummary'
import Dues from './screens/Dues'
import More from './screens/More'
import AddShop from './screens/AddShop'
import Products from './screens/Products'
import StockList from './screens/stock/StockList'
import ReceiveGoods from './screens/stock/ReceiveGoods'
import CompanyPayments from './screens/stock/CompanyPayments'
import MonthlyReport from './screens/MonthlyReport'
import DayDues from './screens/DayDues'
import Settings from './screens/Settings'

// Every page in the app. `bar` = which bottom-bar button is lit while it is open.
// To add a module: add a page here and a tile on the More screen.
const PAGES = {
  home: { title: 'Home', Screen: Home, bar: 'home' },
  sale: { title: 'Sale', Screen: RecordSale, bar: 'sale' },
  day: { title: 'Day', Screen: DaySummary, bar: 'day' },
  daydues: { title: 'Dues from this day', Screen: DayDues, bar: 'day' },
  dues: { title: 'Dues', Screen: Dues, bar: 'dues' },
  more: { title: 'More', Screen: More, bar: 'more' },
  stock: { title: 'In stock', Screen: StockList, bar: 'more' },
  receive: { title: 'Receive goods', Screen: ReceiveGoods, bar: 'more' },
  company: { title: 'Company payments', Screen: CompanyPayments, bar: 'more' },
  shops: { title: 'Shops', Screen: AddShop, bar: 'more' },
  products: { title: 'Products', Screen: Products, bar: 'more' },
  report: { title: 'Monthly report', Screen: MonthlyReport, bar: 'more' },
  settings: { title: 'Settings', Screen: Settings, bar: 'more' },
}

// The signed-in user's id is remembered on the phone so the app can open with no internet.
const USER_KEY = 'dealer.user_id'
const remembered = () => { try { return localStorage.getItem(USER_KEY) } catch { return null } }
const remember = (id) => { try { id ? localStorage.setItem(USER_KEY, id) : localStorage.removeItem(USER_KEY) } catch { /* ignore */ } }

export default function App() {
  // pages opened on top of each other; the last one is on screen. The bottom bar starts a new stack.
  const [stack, setStack] = useState([{ page: 'home', params: {} }])
  const current = stack[stack.length - 1]
  const nav = {
    go: (page, params = {}) => setStack((st) => [...st, { page, params }]),
    root: (page, params = {}) => setStack([{ page, params }]),
    back: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : [{ page: 'home', params: {} }])),
  }

  // every page starts at the top, not where the last one was scrolled to
  useEffect(() => { window.scrollTo(0, 0) }, [stack])

  // the phone's back button: one page back, then Home, then leave the app
  const stackRef = useRef(stack)
  stackRef.current = stack
  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      const st = stackRef.current
      if (st.length > 1) setStack(st.slice(0, -1))
      else if (st[0].page !== 'home') setStack([{ page: 'home', params: {} }])
      else CapApp.exitApp()
    })
    return () => { sub.then((h) => h.remove()) }
  }, [])
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

  // Sign out of this phone only. Works offline too: if the server can't be told, the saved login
  // is removed locally. The phone's data stays and is used again after signing in to the same account.
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch {
      try { Object.keys(localStorage).filter((k) => k.endsWith('-auth-token')).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
    }
    remember(null)
    setUserId(null)
    setStack([{ page: 'home', params: {} }])
    setPhase('login')
  }

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

  const { Screen, title, bar } = PAGES[current.page]
  const pushed = stack.length > 1
  const pageTitle = current.params.title ?? (current.page === 'sale' && current.params.editSaleId ? 'Edit sale' : title)

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-50 pb-28 pt-[env(safe-area-inset-top)]">
      {pushed && (
        <header className="sticky top-0 z-30 flex items-center gap-1 border-b bg-white/95 px-1 py-1 backdrop-blur">
          <button type="button" onClick={nav.back} aria-label="Back" className="rounded-full p-2 text-gray-700 active:bg-gray-100">
            <Icon name="back" className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">{pageTitle}</h1>
        </header>
      )}
      <main className="p-4">
        <SyncBar />
        <Screen
          key={`${stack.length}-${current.page}`}
          nav={nav}
          {...current.params}
          onEditSale={(id) => nav.go('sale', { editSaleId: id })}
          onDoneEditing={nav.back}
          onSignOut={signOut}
        />
      </main>
      <BottomBar active={bar} onSelect={(page) => nav.root(page)} />
    </div>
  )
}
