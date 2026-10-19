import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const empty = { name: '', perCarton: '', buyPrice: '', mrp: '' }

export default function Products() {
  const [form, setForm] = useState(empty)
  const [products, setProducts] = useState([])
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const load = async () => {
    const { data } = await supabase
      .from('products')
      .select('id, name, pieces_per_carton, unit_buy_price, unit_mrp')
      .is('deleted_at', null)
      .order('name')
    setProducts(data || [])
  }
  useEffect(() => { load() }, [])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const save = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const perCarton = Number(form.perCarton)
    const buyPrice = Number(form.buyPrice)
    if (!name) return setMsg({ type: 'err', text: 'Enter a product name' })
    if (!(perCarton > 0)) return setMsg({ type: 'err', text: 'Pieces per carton must be above 0' })
    if (form.buyPrice === '' || buyPrice < 0) return setMsg({ type: 'err', text: 'Enter the buy price per piece' })
    if (form.mrp !== '' && Number(form.mrp) < 0) return setMsg({ type: 'err', text: 'MRP cannot be negative' })
    setSaving(true)
    const row = {
      name,
      pieces_per_carton: perCarton,
      unit_buy_price: buyPrice,
      unit_mrp: form.mrp === '' ? null : Number(form.mrp),
    }
    const { error } = editingId
      ? await supabase.from('products').update(row).eq('id', editingId)
      : await supabase.from('products').insert(row)
    setSaving(false)
    if (error) return setMsg({ type: 'err', text: error.message })
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
    if (!window.confirm(`Delete "${p.name}"? Past sales are not affected.`)) return
    const { error } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', p.id)
    if (error) return setMsg({ type: 'err', text: error.message })
    if (editingId === p.id) cancelEdit()
    setMsg({ type: 'ok', text: 'Product deleted' })
    load()
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Products</h1>
      <form onSubmit={save} className="space-y-3">
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
              <button onClick={() => remove(p)} className="text-red-600">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
