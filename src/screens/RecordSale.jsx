import { useEffect, useMemo, useState } from 'react'
import { repo } from '../local'
import SearchSelect from '../components/SearchSelect'
import { fmtQty } from '../lib/qty'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const toCents = (v) => Math.round((Number(v) || 0) * 100)
const fmt = (c) =>
  (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let nextKey = 1
const newLine = () => ({ key: nextKey++, productId: '', cartons: '', pieces: '', price: '' })

// Lines that come from a saved sale (edit mode) also carry:
//   itemId: the saved line, origProductId: its product, buyPrice: the buy price it was sold at.
const lineFromItem = (it) => {
  const per = it.product.pieces_per_carton || 0
  return {
    key: nextKey++,
    productId: it.product_id,
    cartons: per ? String(Math.floor(it.qty_pieces / per) || '') : '',
    pieces: String((per ? it.qty_pieces % per : it.qty_pieces) || ''),
    price: it.unit_sell_price === null ? '' : String(it.unit_sell_price),
    itemId: it.id,
    origProductId: it.product_id,
    buyPrice: it.unit_buy_price,
  }
}
// a saved line keeps its id (and original buy price) only while its product is unchanged
const keepsSavedLine = (l) => Boolean(l.itemId) && l.productId === l.origProductId

// One numbered step of the form: 1 Shop & date, 2 Items, 3 Payment.
function Section({ n, title, aside, children }) {
  return (
    <section className="space-y-3 rounded-xl border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">{n}</span>
          {title}
        </h2>
        {aside && <span className="text-sm text-gray-500">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

export default function RecordSale({ editSaleId = null, onDoneEditing = () => {} }) {
  const [editing, setEditing] = useState(null) // the sale being edited, or null for a new sale
  const [shops, setShops] = useState([])
  const [products, setProducts] = useState([])
  const [shopId, setShopId] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [lines, setLines] = useState([newLine()])
  const [billInput, setBillInput] = useState(null) // null = follow line prices (when all priced)
  const [paidInput, setPaidInput] = useState(null) // null = follow bill
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [newShop, setNewShop] = useState(null) // { name, area, phone, error } while adding a shop from here

  const saveNewShop = async () => {
    try {
      const id = await repo.addShop(newShop)
      setShops(repo.listShops())
      setShopId(id)
      setNewShop(null)
    } catch (e) {
      setNewShop((n) => ({ ...n, error: e.message }))
    }
  }

  const resetForm = () => {
    setNewShop(null)
    setShopId('')
    setDate(todayDhaka())
    setLines([newLine()])
    setBillInput(null)
    setPaidInput(null)
  }

  useEffect(() => {
    setShops(repo.listShops())
    const active = repo.listProducts({ activeOnly: true })
    if (!editSaleId) {
      setProducts(active)
      setEditing(null)
      resetForm()
      return
    }
    const sale = repo.getSale(editSaleId)
    if (!sale) {
      setProducts(active)
      setEditing(null)
      return setMsg({ type: 'err', text: 'That sale no longer exists' })
    }
    // products of this sale that were deleted since still need to show on its lines
    const known = new Set(active.map((p) => p.id))
    setProducts([...active, ...sale.items.map((i) => i.product).filter((p) => !known.has(p.id) && known.add(p.id))])
    setEditing(sale)
    setMsg(null)
    setShopId(sale.shop_id)
    setDate(sale.sale_date)
    setLines(sale.items.length ? sale.items.map(lineFromItem) : [newLine()])
    setBillInput(sale.bill_amount === null ? '' : String(sale.bill_amount))
    setPaidInput(String(sale.paid_amount))
  }, [editSaleId])

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
        `${p.pieces_per_carton} pcs/carton`,
        `buy ${Number(p.unit_buy_price)}/pc`,
        `carton ${(p.pieces_per_carton * p.unit_buy_price).toFixed(2)}`,
        p.unit_mrp != null && `MRP ${Number(p.unit_mrp)}`,
      ].filter(Boolean).join(' · '),
    })),
    [products]
  )

  const qtyOf = (l) => {
    const p = productById[l.productId]
    return (Number(l.cartons) || 0) * (p?.pieces_per_carton || 0) + (Number(l.pieces) || 0)
  }

  const allPriced = lines.every((l) => l.price !== '')
  const totalC = lines.reduce((sum, l) => sum + qtyOf(l) * toCents(l.price), 0)
  const buyOf = (l) => (keepsSavedLine(l) ? l.buyPrice : productById[l.productId]?.unit_buy_price || 0)
  const costC = lines.reduce((sum, l) => sum + Math.round(qtyOf(l) * buyOf(l) * 100), 0)
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
    const sale = {
      shopId,
      saleDate: date,
      billAmount: billC / 100,
      paidAmount: paidC / 100,
      items: lines.map((l) => ({
        itemId: keepsSavedLine(l) ? l.itemId : undefined,
        productId: l.productId,
        qtyPieces: qtyOf(l),
        unitSellPrice: l.price === '' ? null : l.price,
      })),
    }
    try {
      if (editing) await repo.updateSale(editing.id, sale)
      else await repo.createSale(sale)
    } catch (error) {
      setSaving(false)
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    if (editing) return onDoneEditing() // back to the Day screen
    setMsg({
      type: 'ok',
      text: dueC > 0 ? `Saved. Due: ${fmt(dueC)}` : `Saved. Profit: ${fmt(profitC)}`,
    })
    resetForm()
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      {/* when editing, the page header already says "Edit sale" */}
      {!editing && <h1 className="text-lg font-semibold">Record sale</h1>}
      {editing && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Changing a saved sale{editing.sale_date < todayDhaka() ? ` from ${editing.sale_date}` : ''}.
            Totals, stock and dues update by themselves.
          </span>
          <button type="button" onClick={onDoneEditing} className="shrink-0 font-medium underline">Cancel</button>
        </div>
      )}

      <Section n={1} title="Shop & date">
        <SearchSelect
          options={shopOptions}
          value={shopId}
          onChange={(v) => { setShopId(v); setNewShop(null) }}
          placeholder="Search shop"
          onCreate={(name) => setNewShop({ name, area: '', phone: '', error: null })}
          createLabel="Add new shop"
        />
        {newShop && (
          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
            <div className="text-sm font-medium text-blue-800">New shop</div>
            <input aria-label="New shop name" placeholder="Shop name" value={newShop.name}
              onChange={(e) => setNewShop({ ...newShop, name: e.target.value, error: null })} className={input} />
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Area (optional)" value={newShop.area}
                onChange={(e) => setNewShop({ ...newShop, area: e.target.value, error: null })} className={input} />
              <input type="tel" placeholder="Phone (optional)" value={newShop.phone}
                onChange={(e) => setNewShop({ ...newShop, phone: e.target.value, error: null })} className={input} />
            </div>
            {newShop.error && <p className="text-sm text-red-600">{newShop.error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={saveNewShop}
                className="flex-1 rounded-lg bg-blue-600 py-2 font-medium text-white">Save shop</button>
              <button type="button" onClick={() => setNewShop(null)}
                className="flex-1 rounded-lg border bg-white py-2 text-gray-600">Cancel</button>
            </div>
          </div>
        )}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      </Section>

      <Section n={2} title="Items"
        aside={`${lines.filter((l) => l.productId).length} item${lines.filter((l) => l.productId).length === 1 ? '' : 's'}`}>
        {lines.map((l, i) => {
          const p = productById[l.productId]
          const qty = qtyOf(l)
          const lineCostC = p ? Math.round(qty * buyOf(l) * 100) : 0
          return (
            <div key={l.key} className="space-y-2 rounded-lg border bg-gray-50/60 p-3">
              <div className="flex items-center justify-between text-xs font-medium text-gray-500">
                <span>Item {i + 1}</span>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    className="text-sm font-normal text-red-600">Remove</button>
                )}
              </div>
              <SearchSelect
                options={productOptions}
                value={l.productId}
                onChange={(v) => setLine(l.key, { productId: v })}
                placeholder="Search product"
                disabledValues={lines.map((x) => x.productId).filter(Boolean)}
              />
              {p && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
                  <span>{p.pieces_per_carton} pcs/ctn</span>
                  <span>
                    Buy {Number(buyOf(l))}/pc · {fmt(Math.round(p.pieces_per_carton * buyOf(l) * 100))}/ctn
                    {keepsSavedLine(l) && buyOf(l) !== p.unit_buy_price && ' (price when sold)'}
                  </span>
                  {p.unit_mrp !== null && <span>MRP {Number(p.unit_mrp)}</span>}
                </div>
              )}
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
              {p && qty > 0 && (
                <div className="text-sm text-gray-600">
                  {fmtQty(qty, p.pieces_per_carton)}{qty >= p.pieces_per_carton ? ` (${qty} pcs)` : ''} · cost {fmt(lineCostC)}
                  {l.price !== '' ? ` · sells ${fmt(qty * toCents(l.price))}` : ''}
                </div>
              )}
            </div>
          )
        })}

        <button type="button" onClick={() => setLines((ls) => [...ls, newLine()])}
          className="w-full rounded-lg border border-dashed p-3 text-blue-600">
          + Add item
        </button>
      </Section>

      <Section n={3} title="Payment">
        {/* worked out from the items and the two boxes below (read only) */}
        <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Worked out for you</div>
          <div className="flex justify-between text-gray-600">
            <span>Your cost for these goods</span><span className="tabular-nums">{fmt(costC)}</span>
          </div>
          {billText === '' ? (
            <p className="text-gray-500">Enter the bill amount below to see the due and profit.</p>
          ) : (
            <>
              <div className={`flex justify-between ${dueC > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                <span>Due (shop still owes)</span><span className="tabular-nums">{fmt(dueC)}</span>
              </div>
              <div className={`flex justify-between font-medium ${profitC < 0 ? 'text-red-600' : 'text-green-700'}`}>
                <span>Profit</span><span className="tabular-nums">{fmt(profitC)}</span>
              </div>
            </>
          )}
        </div>

        <div>
          <label htmlFor="bill" className="block font-medium text-gray-900">Bill amount</label>
          <p className="text-xs text-gray-500">Total the shop has to pay you for these goods</p>
          <input id="bill" inputMode="decimal" placeholder="e.g. 300" value={billText}
            onChange={(e) => setBillInput(e.target.value)} className={`${input} mt-1 text-lg`} />
        </div>

        <div>
          <label htmlFor="paid" className="block font-medium text-gray-900">Money collected now</label>
          <p className="text-xs text-gray-500">Cash you received at this stop</p>
          <input id="paid" inputMode="decimal" placeholder="e.g. 200" value={paidText}
            onChange={(e) => setPaidInput(e.target.value)} className={`${input} mt-1 text-lg`} />
          <div className="mt-2 flex gap-2 text-sm">
            {[[null, 'Paid in full'], ['0', 'Paid nothing']].map(([v, label]) => (
              <button key={label} type="button" onClick={() => setPaidInput(v)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 ${
                  paidInput === v ? 'border-blue-600 bg-blue-50 text-blue-700' : 'bg-white text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {msg && <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>}

      <button onClick={save} disabled={saving}
        className="w-full rounded-lg bg-blue-600 p-4 font-medium text-white disabled:opacity-50">
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Save sale'}
      </button>
    </div>
  )
}
