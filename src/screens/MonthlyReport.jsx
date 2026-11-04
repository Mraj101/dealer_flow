import { useEffect, useState } from 'react'
import { repo } from '../local'
import { fmtQty } from '../lib/qty'
import { fmt, fmtDayShort, fmtMonth, shiftMonth, todayDhaka } from '../lib/format'

const Row = ({ label, value, className = '' }) => (
  <div className={`flex justify-between gap-2 ${className}`}>
    <span>{label}</span><span className="tabular-nums">{value}</span>
  </div>
)

function Tile({ label, value, sub, tone = 'text-gray-900' }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

// One month: totals, each day, best shops and products. Tapping a day opens that day.
export default function MonthlyReport({ nav }) {
  const thisMonth = todayDhaka().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [r, setR] = useState(null)
  const [view, setView] = useState('days') // days | shops | products

  useEffect(() => { setR(repo.monthReport(month)) }, [month])
  if (!r) return null
  const t = r.totals

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
          className="rounded-lg border bg-white px-4 py-3 text-lg leading-none">‹</button>
        <div className="flex-1 rounded-lg border bg-white py-3 text-center font-semibold">{fmtMonth(month)}</div>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}
          aria-label="Next month" className="rounded-lg border bg-white px-4 py-3 text-lg leading-none disabled:opacity-30">›</button>
      </div>

      {t.sales === 0 && t.cash_in === 0 ? (
        <p className="py-8 text-center text-gray-500">Nothing recorded in {fmtMonth(month)}</p>
      ) : (
        <>
          <section className="rounded-xl bg-blue-600 p-4 text-white">
            <div className="text-sm text-blue-100">Cash in this month</div>
            <div className="text-3xl font-bold tabular-nums">{fmt(t.cash_in)}</div>
            <div className="mt-2 space-y-0.5 text-sm text-blue-100">
              <Row label="From sales" value={fmt(t.collected)} />
              <Row label="Old dues collected" value={fmt(t.dues_in)} />
              {t.driver_in > 0 && <Row label="From drivers (missing goods)" value={fmt(t.driver_in)} />}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-2">
            <Tile label="Profit" value={fmt(t.profit)} tone={t.profit < 0 ? 'text-red-600' : 'text-green-700'} />
            <Tile label="Sold (bills)" value={fmt(t.billed)} sub={`${t.sales} sales · ${t.shops} shops`} />
            <Tile label="Cost of goods" value={fmt(t.cost)} />
            <Tile label="Still unpaid" value={fmt(t.still_due)} sub={`of ${fmt(t.due)} due this month`}
              tone={t.still_due > 0 ? 'text-red-600' : 'text-gray-900'} />
          </div>

          {(r.stock.goods_received > 0 || r.stock.paid_to_company > 0) && (
            <section className="space-y-1 rounded-xl border bg-white p-3 text-sm text-gray-700">
              <h2 className="font-semibold text-gray-900">Company</h2>
              <Row label="Goods received (memos)" value={fmt(r.stock.goods_received)} />
              <Row label="Paid to the company" value={fmt(r.stock.paid_to_company)} />
            </section>
          )}

          <div className="flex rounded-lg border bg-white p-1" role="tablist">
            {[['days', 'By day'], ['shops', 'Shops'], ['products', 'Products']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={`flex-1 rounded-md py-2 text-sm font-medium ${view === id ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>

          {view === 'days' && (
            <div className="overflow-hidden rounded-xl border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="p-2 pl-3 font-normal">Day</th>
                    <th className="p-2 text-right font-normal">Sold</th>
                    <th className="p-2 text-right font-normal">Cash in</th>
                    <th className="p-2 pr-3 text-right font-normal">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {r.days.map((d) => (
                    <tr key={d.date} onClick={() => nav.go('day', { initialDate: d.date })} className="cursor-pointer active:bg-gray-50">
                      <td className="p-2 pl-3">
                        {fmtDayShort(d.date)}
                        <div className="text-xs text-gray-500">{d.sales} sale{d.sales === 1 ? '' : 's'}</div>
                      </td>
                      <td className="p-2 text-right tabular-nums">{fmt(d.billed)}</td>
                      <td className="p-2 text-right tabular-nums">{fmt(d.collected + d.dues_in + d.driver_in)}</td>
                      <td className={`p-2 pr-3 text-right tabular-nums ${d.profit < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(d.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t p-2 text-center text-xs text-gray-500">Tap a day to open it</p>
            </div>
          )}

          {view === 'shops' && (
            <ul className="divide-y rounded-xl border bg-white text-sm">
              {r.shops.map((s) => (
                <li key={s.shop_id} className="flex justify-between gap-2 p-3">
                  <span>
                    {s.name}
                    <span className="block text-xs text-gray-500">
                      {[s.area, `${s.sales} sale${s.sales === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {fmt(s.billed)}
                    <span className="block text-xs text-gray-500">profit {fmt(s.profit)}</span>
                    {s.still_due > 0 && <span className="block text-xs text-red-600">due {fmt(s.still_due)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {view === 'products' && (
            <ul className="divide-y rounded-xl border bg-white text-sm">
              {r.products.map((p) => (
                <li key={p.product_id} className="flex justify-between gap-2 p-3">
                  <span>
                    {p.name}
                    <span className="block text-xs text-gray-500">
                      {p.pieces_per_carton} pcs/ctn · {p.shops} shop{p.shops === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="text-right">
                    {fmtQty(p.qty_pieces, p.pieces_per_carton)}
                    <span className="block text-xs tabular-nums text-gray-500">cost {fmt(p.cost)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
