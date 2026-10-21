import { useEffect, useState } from 'react'
import { repo } from '../local'

const empty = { name: '', area: '', phone: '' }

export default function AddShop() {
  const [form, setForm] = useState(empty)
  const [shops, setShops] = useState([])
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }
  const [saving, setSaving] = useState(false)

  const load = () => setShops(repo.listShops({ sort: 'area' }))
  useEffect(() => { load() }, [])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await repo.addShop({ name: form.name, area: form.area, phone: form.phone })
    } catch (error) {
      setSaving(false)
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
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
