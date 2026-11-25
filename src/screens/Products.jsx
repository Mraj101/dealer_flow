import { useEffect, useState } from 'react'
import { repo } from '../local'
import { ConfirmDialog, Summary } from '../components/ui'
import { haptic } from '../lib/haptics'

const empty = { name: '', perCarton: '', buyPrice: '', mrp: '' }

export default function Products() {
  const [form, setForm] = useState(empty)
  const [products, setProducts] = useState([])
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirming, setConfirming] = useState(false) // save question open
  const [deleting, setDeleting] = useState(null) // product whose delete question is open

  const load = () => setProducts(repo.listProducts())
  useEffect(() => { load() }, [])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const problem = () => {
    if (!form.name.trim()) return 'Enter a product name'
    if (!(Number(form.perCarton) > 0)) return 'Pieces per carton must be above 0'
    if (form.buyPrice === '' || Number(form.buyPrice) < 0) return 'Enter the buy price per piece'
    if (form.mrp !== '' && Number(form.mrp) < 0) return 'MRP cannot be negative'
    return null
  }

  // check the form, then ask "are you sure?" before saving
  const askSave = (e) => {
    e.preventDefault()
    const err = problem()
    if (err) {
      haptic.error()
      return setMsg({ type: 'err', text: err })
    }
    setMsg(null)
    setConfirming(true)
  }

  const save = async () => {
    setConfirming(false)
    setSaving(true)
    try {
      await repo.saveProduct({
        id: editingId,
        name: form.name.trim(),
        pieces_per_carton: Number(form.perCarton),
        unit_buy_price: form.buyPrice,
        unit_mrp: form.mrp === '' ? null : form.mrp,
      })
    } catch (error) {
      setSaving(false)
      haptic.error()
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    haptic.success()
    setMsg({ type: 'ok', text: editingId ? 'Product updated' : 'Product added' })
    cancelEdit()
    load()
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(empty)
  }

  const startEdit = (p) => {
    setEditingId(p.id)
    setMsg(null)
    setForm({
      name: p.name,
      perCarton: String(p.pieces_per_carton),
      buyPrice: String(Number(p.unit_buy_price)),
      mrp: p.unit_mrp == null ? '' : String(Number(p.unit_mrp)),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // soft delete: past sales keep their copied buy price
  const remove = async (p) => {
    setDeleting(null)
    try {
      await repo.deleteProduct(p.id)
    } catch (error) {
      haptic.error()
      return setMsg({ type: 'err', text: error.message })
    }
    haptic.success()
    if (editingId === p.id) cancelEdit()
    setMsg({ type: 'ok', text: 'Product deleted' })
    load()
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <form onSubmit={askSave} className="space-y-3">
        <input value={form.name} onChange={(e) => set({ name: e.target.value })}
          placeholder="Product name" className={input} />
        <input inputMode="numeric" value={form.perCarton}
          onChange={(e) => set({ perCarton: e.target.value.replace(/\D/g, '') })}
          placeholder="Pieces per carton" className={input} />
        <div className="grid grid-cols-2 gap-2">
          <input inputMode="decimal" value={form.buyPrice}
            onChange={(e) => set({ buyPrice: e.target.value })}
            placeholder="Buy price (1 piece)" className={input} />
          <input inputMode="decimal" value={form.mrp}
            onChange={(e) => set({ mrp: e.target.value })}
            placeholder="MRP (optional)" className={input} />
        </div>
        <button disabled={saving}
          className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:opacity-50">
          {saving ? 'Saving…' : editingId ? 'Update product' : 'Save product'}
        </button>
        {editingId && (
          <button type="button" onClick={cancelEdit}
            className="w-full rounded-lg border p-3 text-gray-600">
            Cancel edit
          </button>
        )}
      </form>
      {msg && (
        <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>
      )}
      {confirming && (() => {
        const per = Number(form.perCarton)
        const buy = Number(form.buyPrice)
        const old = editingId && products.find((x) => x.id === editingId)
        return (
          <ConfirmDialog title={editingId ? 'Update this product?' : 'Add this product?'}
            yesLabel={editingId ? 'Yes, update' : 'Yes, add product'} noLabel="No, go back"
            onNo={() => setConfirming(false)} onYes={save}>
            <Summary rows={[
              ['Product name', form.name.trim()],
              ['Pieces per carton', per],
              ['Buy price (1 piece)', buy.toFixed(2)],
              ['Buy price (1 carton)', (per * buy).toFixed(2)],
              ['MRP', form.mrp === '' ? '—' : Number(form.mrp).toFixed(2)],
            ]} />
            {old && Number(old.unit_buy_price) !== buy && (
              <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                Buy price changes from {Number(old.unit_buy_price)} to {buy}. Past sales keep their old price.
              </p>
            )}
            <p>Are you sure these details are correct?</p>
          </ConfirmDialog>
        )
      })()}
      {deleting && (
        <ConfirmDialog title="Delete this product?" danger yesLabel="Yes, delete" noLabel="No, keep it"
          onNo={() => setDeleting(null)} onYes={() => remove(deleting)}>
          <Summary rows={[
            ['Product', deleting.name],
            ['Pieces per carton', deleting.pieces_per_carton],
            ['Buy price (1 piece)', Number(deleting.unit_buy_price)],
          ]} />
          <p>Past sales are not affected. Are you sure?</p>
        </ConfirmDialog>
      )}
      <ul className="divide-y rounded-lg border bg-white">
        {products.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 p-3">
            <div>
              <div>{p.name}</div>
              <div className="text-sm text-gray-600">
                {p.pieces_per_carton} pcs/carton · buy {Number(p.unit_buy_price)}/pc
                {p.unit_mrp != null && ` · MRP ${Number(p.unit_mrp)}`}
              </div>
            </div>
            <div className="flex shrink-0 gap-3 text-sm">
              <button onClick={() => startEdit(p)} className="text-blue-600">Edit</button>
              <button onClick={() => setDeleting(p)} className="text-red-600">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
