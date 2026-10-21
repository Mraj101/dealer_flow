import { useEffect, useMemo, useState } from 'react'
import { repo } from '../../local'
import { fmtQty } from '../../lib/qty'
import SearchSelect from '../../components/SearchSelect'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const toCents = (v) => Math.round((Number(v) || 0) * 100)
const fmt = (c) =>
  (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let nextKey = 1
// received blank = everything on the memo arrived
const newLine = () => ({ key: nextKey++, productId: '', memoCtn: '', memoPcs: '', recvCtn: '', recvPcs: '' })

export default function ReceiveGoods() {
  const [products, setProducts] = useState([])
  const [recent, setRecent] = useState([])
  const [date, setDate] = useState(todayDhaka())
  const [memoNo, setMemoNo] = useState('')
  const [driver, setDriver] = useState('')
  const [lines, setLines] = useState([newLine()])
  const [memoInput, setMemoInput] = useState(null) // null = follow memo value at buy price
  const [driverInput, setDriverInput] = useState(null) // null = follow shortage value
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const loadRecent = () => setRecent(repo.recentReceipts(10))

  useEffect(() => {
    setProducts(repo.listProducts({ activeOnly: true }))
    loadRecent()
  }, [])

  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [String(p.id), p])), [products]
  )
  const productOptions = useMemo(
    () => products.map((p) => ({
      value: p.id,
      label: p.name,
      hint: `${p.pieces_per_carton} pcs/carton · buy ${Number(p.unit_buy_price)}/pc`,
    })),
    [products]
  )

  const perOf = (l) => productById[l.productId]?.pieces_per_carton || 0
  const memoQty = (l) => (Number(l.memoCtn) || 0) * perOf(l) + (Number(l.memoPcs) || 0)
  const recvQty = (l) =>
    l.recvCtn === '' && l.recvPcs === ''
      ? memoQty(l)
      : (Number(l.recvCtn) || 0) * perOf(l) + (Number(l.recvPcs) || 0)
  const buyOf = (l) => productById[l.productId]?.unit_buy_price || 0

  const memoValueC = lines.reduce((s, l) => s + Math.round(memoQty(l) * buyOf(l) * 100), 0)
  const shortC = lines.reduce(
    (s, l) => s + Math.round(Math.max(memoQty(l) - recvQty(l), 0) * buyOf(l) * 100), 0
  )
  const memoText = memoInput ?? (memoValueC / 100).toFixed(2)
  const driverText = driverInput ?? (shortC / 100).toFixed(2)

  const setLine = (key, patch) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const digits = (v) => v.replace(/\D/g, '')

  const validate = () => {
    if (lines.some((l) => !l.productId)) return 'Every line needs a product'
    if (lines.some((l) => memoQty(l) === 0 && recvQty(l) === 0)) return 'Every line needs a quantity'
    if (memoText === '' || toCents(memoText) < 0) return 'Enter the memo amount'
    if (toCents(driverText) < 0) return 'Driver amount cannot be negative'
    return null
  }

  const save = async () => {
    const err = validate()
    if (err) return setMsg({ type: 'err', text: err })
    setSaving(true)
    try {
      await repo.createReceipt({
        receiveDate: date,
        memoNo,
        memoAmount: toCents(memoText) / 100,
        driverName: driver,
        driverPaid: toCents(driverText) / 100,
        note: null,
        items: lines.map((l) => ({
          productId: l.productId,
          memoQtyPieces: memoQty(l),
          receivedQtyPieces: recvQty(l),
        })),
      })
    } catch (error) {
      setSaving(false)
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    setMsg({ type: 'ok', text: 'Delivery saved, stock updated' })
    setMemoNo('')
    setDriver('')
    setLines([newLine()])
    setMemoInput(null)
    setDriverInput(null)
    loadRecent()
  }

  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      <div className="grid grid-cols-2 gap-2">
        <input value={memoNo} onChange={(e) => setMemoNo(e.target.value)}
          placeholder="Memo no. (optional)" className={input} />
        <input value={driver} onChange={(e) => setDriver(e.target.value)}
          placeholder="Driver (optional)" className={input} />
      </div>

      {lines.map((l) => {
        const p = productById[l.productId]
        const short = memoQty(l) - recvQty(l)
        return (
          <div key={l.key} className="space-y-2 rounded-lg border bg-white p-3">
            <SearchSelect
              options={productOptions}
              value={l.productId}
              onChange={(v) => setLine(l.key, { productId: v })}
              placeholder="Search product"
              disabledValues={lines.map((x) => x.productId).filter(Boolean)}
            />
            <div className="text-sm text-gray-600">On memo</div>
            <div className="grid grid-cols-2 gap-2">
              <input inputMode="numeric" placeholder="Cartons" value={l.memoCtn}
                onChange={(e) => setLine(l.key, { memoCtn: digits(e.target.value) })} className={input} />
              <input inputMode="numeric" placeholder="Pieces" value={l.memoPcs}
                onChange={(e) => setLine(l.key, { memoPcs: digits(e.target.value) })} className={input} />
            </div>
            <div className="text-sm text-gray-600">Actually received (leave blank if all came)</div>
            <div className="grid grid-cols-2 gap-2">
              <input inputMode="numeric" placeholder="Cartons" value={l.recvCtn}
                onChange={(e) => setLine(l.key, { recvCtn: digits(e.target.value) })} className={input} />
              <input inputMode="numeric" placeholder="Pieces" value={l.recvPcs}
                onChange={(e) => setLine(l.key, { recvPcs: digits(e.target.value) })} className={input} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className={short > 0 ? 'text-red-600' : 'text-gray-600'}>
                {p && (short > 0
                  ? `Short ${fmtQty(short, p.pieces_per_carton)}`
                  : short < 0
                    ? `Extra ${fmtQty(-short, p.pieces_per_carton)}`
                    : `${fmtQty(recvQty(l), p.pieces_per_carton)} OK`)}
              </span>
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
        + Add product
      </button>

      <div className="space-y-2 rounded-lg border bg-white p-3">
        <label className="block text-sm text-gray-600">
          Memo amount (company charged) · at buy price {fmt(memoValueC)}
        </label>
        <input inputMode="decimal" value={memoText}
          onChange={(e) => setMemoInput(e.target.value)} className={input} />
        <div className={`flex justify-between ${shortC > 0 ? 'text-red-600' : 'text-gray-600'}`}>
          <span>Missing goods value</span><span>{fmt(shortC)}</span>
        </div>
        <label className="block text-sm text-gray-600">Taken from driver for missing goods</label>
        <input inputMode="decimal" value={driverText}
          onChange={(e) => setDriverInput(e.target.value)} className={input} />
      </div>

      {msg && <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>}

      <button onClick={save} disabled={saving}
        className="w-full rounded-lg bg-blue-600 p-4 font-medium text-white disabled:opacity-50">
        {saving ? 'Saving…' : 'Save delivery'}
      </button>

      {recent.length > 0 && (
        <>
          <h2 className="pt-2 font-semibold">Recent deliveries</h2>
          <ul className="divide-y rounded-lg border bg-white">
            {recent.map((r) => (
              <li key={r.id} className="p-3">
                <div className="flex justify-between">
                  <span>{r.receive_date}{r.memo_no ? ` · #${r.memo_no}` : ''}</span>
                  <span>{fmt(toCents(r.memo_amount))}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {r.driver_name || 'No driver'}
                  {r.short_pieces > 0 && (
                    <span className="text-red-600">
                      {' '}· short {r.short_pieces} pcs ({fmt(toCents(r.short_value))})
                    </span>
                  )}
                  {Number(r.driver_paid) > 0 && ` · driver paid ${fmt(toCents(r.driver_paid))}`}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
