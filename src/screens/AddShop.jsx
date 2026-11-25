import { useEffect, useState } from 'react'
import { repo } from '../local'
import { ConfirmDialog, Summary } from '../components/ui'
import { haptic } from '../lib/haptics'

const empty = { name: '', area: '', phone: '' }

export default function AddShop({ nav }) {
  const [form, setForm] = useState(empty)
  const [shops, setShops] = useState([])
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = () => setShops(repo.listShops({ sort: 'area' }))
  useEffect(() => { load() }, [])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  // check the form, then ask "are you sure?" before saving
  const askSave = (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      haptic.error()
      return setMsg({ type: 'err', text: 'Enter a shop name' })
    }
    setMsg(null)
    setConfirming(true)
  }

  const save = async () => {
    setConfirming(false)
    setSaving(true)
    try {
      await repo.addShop({ name: form.name, area: form.area, phone: form.phone })
    } catch (error) {
      setSaving(false)
      haptic.error()
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    haptic.success()
    setForm(empty)
    setMsg({ type: 'ok', text: 'Shop added' })
    load()
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <form onSubmit={askSave} className="space-y-3">
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
      {confirming && (
        <ConfirmDialog title="Add this shop?" yesLabel="Yes, add shop" noLabel="No, go back"
          onNo={() => setConfirming(false)} onYes={save}>
          <Summary rows={[
            ['Shop name', form.name.trim()],
            ['Area', form.area.trim() || '—'],
            ['Phone', form.phone.trim() || '—'],
          ]} />
          <p>Are you sure these details are correct?</p>
        </ConfirmDialog>
      )}
      <ul className="divide-y rounded-lg border bg-white">
        {shops.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => nav.go('shop', { shopId: s.id })}
              className="flex w-full items-center justify-between gap-2 p-3 text-left active:bg-gray-50">
              <span className="min-w-0">
                <span className="block">{s.name}</span>
                {(s.area || s.phone) && (
                  <span className="block text-sm text-gray-600">{[s.area, s.phone].filter(Boolean).join(' · ')}</span>
                )}
              </span>
              <span className="shrink-0 text-sm text-blue-600">History ›</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
