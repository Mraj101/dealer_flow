import { useEffect, useState } from 'react'
import { repo } from '../../local'
import { fmtQty } from '../../lib/qty'

const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function StockList() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    const products = repo.listProducts()
    const byId = Object.fromEntries(repo.productStock().map((s) => [s.product_id, s]))
    setRows(products.map((p) => {
      const s = byId[p.id] || { received_pieces: 0, sold_pieces: 0 }
      const pieces = s.received_pieces - s.sold_pieces
      return { ...p, ...s, pieces, value: pieces * p.unit_buy_price }
    }))
  }, [])

  const shown = q.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()))
    : rows
  const totalValue = rows.reduce((s, r) => s + Math.max(r.value, 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex justify-between rounded-lg border bg-white p-3 font-medium">
        <span>Stock value (buy price)</span><span>{fmt(totalValue)}</span>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product"
        className="w-full rounded-lg border bg-white p-3" />
      <ul className="divide-y rounded-lg border bg-white">
        {shown.map((r) => (
          <li key={r.id} className="p-3">
            <div className="flex justify-between">
              <span>{r.name}</span>
              <span className={`font-medium ${r.pieces < 0 ? 'text-red-600' : ''}`}>
                {fmtQty(r.pieces, r.pieces_per_carton)}
              </span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>
                In {fmtQty(r.received_pieces, r.pieces_per_carton)} · Sold {fmtQty(r.sold_pieces, r.pieces_per_carton)}
              </span>
              <span>{fmt(r.value)}</span>
            </div>
          </li>
        ))}
      </ul>
      {rows.some((r) => r.pieces < 0) && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Red = sold more than received. Enter the goods you already had as a delivery
          (memo amount 0) so stock starts from the right number.
        </p>
      )}
    </div>
  )
}
