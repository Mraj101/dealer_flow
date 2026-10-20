import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import SearchSelect from '../components/SearchSelect'
import { fmtQty } from '../lib/qty'

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
  const [stockById, setStockById] = useState({}) // product id -> pieces in stock
  const [shopId, setShopId] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [lines, setLines] = useState([newLine()])
  const [billInput, setBillInput] = useState(null) // null = follow line prices (when all priced)
  const [paidInput, setPaidInput] = useState(null) // null = follow bill
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('shops').select('id, name, area').is('deleted_at', null).order('name')
      .then(({ data }) => setShops(data || []))
    supabase.from('products')
      .select('id, name, pieces_per_carton, unit_buy_price, unit_mrp')
      .is('deleted_at', null).eq('status', true).order('name')
      .then(({ data }) => setProducts(data || []))
    supabase.from('product_stock').select('product_id, received_pieces, sold_pieces')
      .then(({ data }) => setStockById(Object.fromEntries(
        (data || []).map((s) => [s.product_id, s.received_pieces - s.sold_pieces])
      )))
  }, [])

  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]
  )

  const shopOptions = useMemo(
    () => shops.map((s) => ({ value: s.id, label: s.area ? `${s.name} (${s.area})` : s.name })),
    [shops]
  )
  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.id,
      label: p.name,
      hint: [
        `stock ${fmtQty(stockById[p.id] || 0, p.pieces_per_carton)}`,
        `${p.pieces_per_carton} pcs/carton`,
        `buy ${Number(p.unit_buy_price)}/pc`,
        `carton ${(p.pieces_per_carton * p.unit_buy_price).toFixed(2)}`,
        p.unit_mrp != null && `MRP ${Number(p.unit_mrp)}`,
      ].filter(Boolean).join(' · '),
    })),
    [products, stockById]
  )

  const qtyOf = (l) => {
    const p = productById[l.productId]
    return (Number(l.cartons) || 0) * (p?.pieces_per_carton || 0) + (Number(l.pieces) || 0)
  }

  const allPriced = lines.every((l) => l.price !== '')
  const totalC = lines.reduce((sum, l) => sum + qtyOf(l) * toCents(l.price), 0)
  const costC = lines.reduce(
    (sum, l) => sum + Math.round(qtyOf(l) * (productById[l.productId]?.unit_buy_price || 0) * 100), 0
  )
  const billText = billInput ?? (allPriced ? (totalC / 100).toFixed(2) : '')
  const billC = toCents(billText)
  const paidText = paidInput ?? billText
  const paidC = toCents(paidText)
  const dueC = billC - paidC
  const profitC = billC - costC

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const validate = () => {
    if (!shopId) return 'Pick a shop'
    if (lines.length === 0) return 'Add at least one line'
    if (lines.some((l) => !l.productId || qtyOf(l) <= 0)) return 'Every line needs a product and quantity above 0'
    if (lines.some((l) => l.price !== '' && Number(l.price) < 0)) return 'Sell price cannot be negative'
    if (billText === '' || billC < 0) return 'Enter the bill amount'
    if (paidText === '' || paidC < 0) return 'Enter the money collected'
    if (paidC > billC) return 'Money collected cannot be more than the bill'
    return null
  }

  const save = async () => {
    const err = validate()
    if (err) return setMsg({ type: 'err', text: err })
    setSaving(true)
    const { error } = await supabase.rpc('create_sale', {
      p_shop_id: Number(shopId),
      p_sale_date: date,
      p_bill_amount: billC / 100,
      p_paid_amount: paidC / 100,
      p_items: lines.map((l) => ({
        product_id: Number(l.productId),
        qty_pieces: qtyOf(l),
        unit_sell_price: l.price === '' ? null : Number(l.price),
      })),
    })
    setSaving(false)
    if (error) return setMsg({ type: 'err', text: error.message })
    setMsg({
      type: 'ok',
      text: dueC > 0 ? `Saved. Due: ${fmt(dueC)}` : `Saved. Profit: ${fmt(profitC)}`,
    })
    setShopId('')
    setLines([newLine()])
    setBillInput(null)
    setPaidInput(null)
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Record sale</h1>

      <SearchSelect
        options={shopOptions}
        value={shopId}
        onChange={setShopId}
        placeholder="Search shop"
      />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />

      {lines.map((l) => {
        const p = productById[l.productId]
        return (
          <div key={l.key} className="space-y-2 rounded-lg border bg-white p-3">
            <SearchSelect
              options={productOptions}
              value={l.productId}
              onChange={(v) => setLine(l.key, { productId: v })}
              placeholder="Search product"
            />
            <div className="grid grid-cols-3 gap-2">
              <input inputMode="numeric" placeholder="Cartons" value={l.cartons}
                onChange={(e) => setLine(l.key, { cartons: e.target.value.replace(/\D/g, '') })}
                className={input} />
              <input inputMode="numeric" placeholder="Pieces" value={l.pieces}
                onChange={(e) => setLine(l.key, { pieces: e.target.value.replace(/\D/g, '') })}
                className={input} />
              <input inputMode="decimal" placeholder="Price/pc (opt.)" value={l.price}
                onChange={(e) => setLine(l.key, { price: e.target.value })}
                className={input} />
            </div>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>{p ? `${qtyOf(l)} pcs` : ''}</span>
              <span>{l.price !== '' ? fmt(qtyOf(l) * toCents(l.price)) : ''}</span>
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
        <div className="flex justify-between text-gray-600"><span>Cost (buy)</span><span>{fmt(costC)}</span></div>
        <label className="block text-sm text-gray-600">Bill amount (what the shop pays you)</label>
        <input inputMode="decimal" value={billText}
          onChange={(e) => setBillInput(e.target.value)} className={input} />
        <label className="block text-sm text-gray-600">Money collected now</label>
        <input inputMode="decimal" value={paidText}
          onChange={(e) => setPaidInput(e.target.value)} className={input} />
        <div className={`flex justify-between ${dueC > 0 ? 'text-red-600' : 'text-gray-600'}`}>
          <span>Due</span><span>{fmt(dueC)}</span>
        </div>
        <div className={`flex justify-between font-medium ${profitC < 0 ? 'text-red-600' : 'text-green-700'}`}>
          <span>Profit</span><span>{fmt(profitC)}</span>
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
