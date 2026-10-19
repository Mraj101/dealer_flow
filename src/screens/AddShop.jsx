import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const empty = { name: '', area: '', phone: '' }

export default function AddShop() {
  const [form, setForm] = useState(empty)
  const [shops, setShops] = useState([])
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data } = await supabase
      .from('shops')
      .select('id, name, area, phone')
      .is('deleted_at', null)
      .order('area', { nullsFirst: false })
      .order('name')
    setShops(data || [])
  }
  useEffect(() => { load() }, [])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return setMsg({ type: 'err', text: 'Enter a shop name' })
    setSaving(true)
    const { error } = await supabase.from('shops').insert({
      name,
      area: form.area.trim() || null,
      phone: form.phone.trim() || null,
    })
    setSaving(false)
    if (error) {
      return setMsg({
        type: 'err',
        text: error.code === '23505' ? 'This shop already exists in this area' : error.message,
      })
    }
    setForm(empty)
    setMsg({ type: 'ok', text: 'Shop added' })
    load()
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Add shop</h1>
      <form onSubmit={save} className="space-y-3">
        <input value={form.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="Shop name" className={input} />
        <div className="grid grid-cols-2 gap-2">
          <input value={form.area} onChange={(e) => set({ area: e.target.value })}
            placeholder="Area (optional)" className={input} />
          <input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })}
            placeholder="Phone (optional)" className={input} />
        </div>
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
          <li key={s.id} className="p-3">
            <div>{s.name}</div>
            {(s.area || s.phone) && (
              <div className="text-sm text-gray-600">
                {[s.area, s.phone].filter(Boolean).join(' · ')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
