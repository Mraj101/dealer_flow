import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AddShop() {
  const [name, setName] = useState('')
  const [shops, setShops] = useState([])
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('shops')
      .select('id, name')
      .is('deleted_at', null)
      .order('name')
    setShops(data || [])
  }
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault()
    const clean = name.trim()
    if (!clean) return setMsg({ type: 'err', text: 'Enter a shop name' })
    setSaving(true)
    const { error } = await supabase.from('shops').insert({ name: clean })
    setSaving(false)
    if (error) {
      return setMsg({
        type: 'err',
        text: error.code === '23505' ? 'This shop already exists' : error.message,
      })
    }
    setName('')
    setMsg({ type: 'ok', text: 'Shop added' })
    load()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Add shop</h1>
      <form onSubmit={save} className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Shop name"
          className="w-full rounded-lg border bg-white p-3"
        />
        <button
          disabled={saving}
          className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save shop'}
        </button>
      </form>
      {msg && (
        <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>
      )}
      <ul className="divide-y rounded-lg border bg-white">
        {shops.map((s) => (
          <li key={s.id} className="p-3">{s.name}</li>
        ))}
      </ul>
    </div>
  )
}
