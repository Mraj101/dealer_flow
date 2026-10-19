import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message)
  }

  const input = 'w-full rounded-lg border bg-white p-3'
  return (
    <div className="mx-auto min-h-screen max-w-md space-y-4 p-4 pt-20">
      <h1 className="text-xl font-semibold">Dealer App</h1>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} className={input} />
        <input type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} className={input} />
        <button disabled={busy}
          className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
