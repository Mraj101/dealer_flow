import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const toCents = (v) => Math.round((Number(v) || 0) * 100)
const fmt = (c) =>
  (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let nextKey = 1
const newLine = () => ({ key: nextKey++, productId: '', cartons: '', pieces: '', price: '' })

export default function RecordSale() {
  const [shops, setShops] = useState([])
  const [products, setProducts] = useState([])
  const [shopId, setShopId] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [lines, setLines] = useState([newLine()])
  const [paidInput, setPaidInput] = useState(null) // null = follow total
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('shops').select('id, name').is('deleted_at', null).order('name')
      .then(({ data }) => setShops(data || []))
    supabase.from('products')
      .select('id, name, pieces_per_carton')
      .is('deleted_at', null).eq('status', true).order('name')
      .then(({ data }) => setProducts(data || []))
  }, [])

  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]
  )

  const qtyOf = (l) => {
    const p = productById[l.productId]
    return (Number(l.cartons) || 0) * (p?.pieces_per_carton || 0) + (Number(l.pieces) || 0)
  }

  const totalC = lines.reduce((sum, l) => sum + qtyOf(l) * toCents(l.price), 0)
  const paidC = paidInput === null ? totalC : toCents(paidInput)
  const dueC = totalC - paidC

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const validate = () => {
    if (!shopId) return 'Pick a shop'
    if (lines.length === 0) return 'Add at least one line'
    if (lines.some((l) => !l.productId || qtyOf(l) <= 0)) return 'Every line needs a product and quantity above 0'
    if (lines.some((l) => l.price === '' || Number(l.price) < 0)) return 'Every line needs a sell price'
    if (paidC < 0 || paidC > totalC) return 'Paid must be between 0 and the total'
    return null
  }

  const save = async () => {
    const err = validate()
    if (err) return setMsg({ type: 'err', text: err })
    setSaving(true)
    const { error } = await supabase.rpc('create_sale', {
      p_shop_id: Number(shopId),
      p_sale_date: date,
      p_paid_amount: paidC / 100,
      p_items: lines.map((l) => ({
        product_id: Number(l.productId),
        qty_pieces: qtyOf(l),
        unit_sell_price: Number(l.price),
      })),
    })
    setSaving(false)
    if (error) return setMsg({ type: 'err', text: error.message })
    setMsg({ type: 'ok', text: `Saved. Due: ${fmt(dueC)}` })
    setShopId('')
    setLines([newLine()])
    setPaidInput(null)
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Record sale</h1>

      <select value={shopId} onChange={(e) => setShopId(e.target.value)} className={input}>
        <option value="">Select shop</option>
        {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />

      {lines.map((l) => {
        const p = productById[l.productId]
        return (
          <div key={l.key} className="space-y-2 rounded-lg border bg-white p-3">
            <select
              value={l.productId}
              onChange={(e) => setLine(l.key, { productId: e.target.value })}
              className={input}
            >
              <option value="">Select product</option>
              {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <input inputMode="numeric" placeholder="Cartons" value={l.cartons}
                onChange={(e) => setLine(l.key, { cartons: e.target.value.replace(/\D/g, '') })}
                className={input} />
              <input inputMode="numeric" placeholder="Pieces" value={l.pieces}
                onChange={(e) => setLine(l.key, { pieces: e.target.value.replace(/\D/g, '') })}
                className={input} />
              <input inputMode="decimal" placeholder="Price/pc" value={l.price}
                onChange={(e) => setLine(l.key, { price: e.target.value })}
                className={input} />
            </div>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>{p ? `${qtyOf(l)} pcs` : ''}</span>
              <span>{fmt(qtyOf(l) * toCents(l.price))}</span>
              {lines.length > 1 && (
                <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  className="text-red-600">Remove</button>
              )}
            </div>
          </div>
        )
      })}

      <button onClick={() => setLines((ls) => [...ls, newLine()])}
        className="w-full rounded-lg border border-dashed p-3 text-blue-600">
        + Add line
      </button>

      <div className="space-y-2 rounded-lg border bg-white p-3">
        <div className="flex justify-between font-medium"><span>Total</span><span>{fmt(totalC)}</span></div>
        <label className="block text-sm text-gray-600">Paid</label>
        <input inputMode="decimal" value={paidInput === null ? fmt(totalC).replace(/,/g, '') : paidInput}
          onChange={(e) => setPaidInput(e.target.value)} className={input} />
        <div className={`flex justify-between ${dueC > 0 ? 'text-red-600' : 'text-gray-600'}`}>
          <span>Due</span><span>{fmt(dueC)}</span>
        </div>
      </div>

      {msg && <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>}

      <button onClick={save} disabled={saving}
        className="w-full rounded-lg bg-blue-600 p-4 font-medium text-white disabled:opacity-50">
        {saving ? 'Saving…' : 'Save sale'}
      </button>
    </div>
  )
}
