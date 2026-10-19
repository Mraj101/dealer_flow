import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './screens/Login'
import RecordSale from './screens/RecordSale'
import AddShop from './screens/AddShop'

const TABS = [
  { id: 'sale', label: 'Sale', Screen: RecordSale },
  { id: 'shop', label: 'Shops', Screen: AddShop },
]

export default function App() {
  const [tab, setTab] = useState('sale')
  const [session, setSession] = useState(undefined) // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  if (!session) return <Login />

  const { Screen } = TABS.find((t) => t.id === tab)

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-50 pb-20">
      <main className="p-4">
        <Screen />
      </main>
      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md border-t bg-white">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-4 text-sm font-medium ${
              tab === t.id ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex-1 py-4 text-sm font-medium text-gray-500"
        >
          Sign out
        </button>
      </nav>
    </div>
  )
}