import { useEffect, useState } from 'react'
import { repo } from '../local'
import { fmtQty } from '../lib/qty'
import { daysSince, fmt, fmtDate } from '../lib/format'

const ago = (d) => {
  const n = daysSince(d)
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`
}

const Row = ({ label, value, className = '' }) => (
  <div className={`flex justify-between gap-2 ${className}`}>
    <span>{label}</span><span className="tabular-nums">{value}</span>
  </div>
)

function status(r) {
  if (r.still_due <= 0) return { text: 'Paid later ✓', tone: 'bg-green-100 text-green-800' }
  if (r.paid_later > 0) return { text: 'Part paid', tone: 'bg-amber-100 text-amber-900' }
  return { text: 'Unpaid', tone: 'bg-red-100 text-red-700' }
}

// The dues created by one day's sales, and what has happened to each since.
export default function DayDues({ date, nav }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    // still owed first, then the rest
    setRows(repo.dayDues(date).sort((a, b) => b.still_due - a.still_due))
  }, [date])
  if (!rows) return null

  const sum = (k) => rows.reduce((s, r) => s + r[k], 0)

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-gray-500">Sales on</div>
        <div className="text-lg font-semibold">{fmtDate(date)} <span className="text-sm font-normal text-gray-500">· {ago(date)}</span></div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-gray-500">No sale on this day left a due.</p>
      ) : (
        <>
          <section className="space-y-1 rounded-xl border bg-white p-3 text-sm">
            <Row label={`Due from ${rows.length} sale${rows.length === 1 ? '' : 's'} this day`} value={fmt(sum('due'))} />
            <Row label="Paid later since then" value={fmt(sum('paid_later'))} className="text-gray-600" />
            <Row label="Still unpaid now" value={fmt(sum('still_due'))}
              className={`border-t pt-1 font-semibold ${sum('still_due') > 0 ? 'text-red-600' : 'text-green-700'}`} />
            <p className="pt-1 text-xs text-gray-500">
              Money a shop pays later clears its oldest dues first, so a shop with older dues
              may still owe on this day’s sale.
            </p>
          </section>

          <ul className="space-y-3">
            {rows.map((r) => {
              const st = status(r)
              const other = r.shop.balance - r.still_due // what the shop owes from other days
              return (
                <li key={r.id} className="space-y-2 rounded-xl border bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{r.shop.name}</div>
                      <div className="text-xs text-gray-500">
                        {r.shop.area}
                        {r.shop.area && r.shop.phone && ' · '}
                        {r.shop.phone && <a href={`tel:${r.shop.phone}`} className="text-blue-600">{r.shop.phone}</a>}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>{st.text}</span>
                  </div>

                  <div className="truncate text-sm text-gray-600">
                    {r.items.map((it) => `${it.name} ${fmtQty(it.qty_pieces, it.pieces_per_carton)}`).join(' · ')}
                  </div>

                  <div className="space-y-0.5 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">
                    <Row label="Bill" value={fmt(r.total ?? r.paid_amount)} />
                    <Row label="Collected at the sale" value={fmt(r.paid_amount)} />
                    <Row label="Due from this sale" value={fmt(r.due)} />
                    <Row label="Paid later" value={fmt(r.paid_later)} />
                    <Row label="Still due" value={fmt(r.still_due)}
                      className={`font-semibold ${r.still_due > 0 ? 'text-red-600' : 'text-green-700'}`} />
                  </div>

                  <div className="space-y-0.5 text-xs text-gray-600">
                    <div>
                      {r.last_payment
                        ? <>Last payment from this shop: <b>{fmt(r.last_payment.amount)}</b> on {fmtDate(r.last_payment.date)} ({ago(r.last_payment.date)})</>
                        : 'No payment received from this shop since.'}
                    </div>
                    {other > 0.004 && (
                      <div>This shop also owes <b>{fmt(other)}</b> from other days ({fmt(r.shop.balance)} in total).</div>
                    )}
                  </div>

                  {r.shop.balance > 0 && (
                    <button type="button" onClick={() => nav.go('dues', { openShopId: r.shop_id })}
                      className="w-full rounded-lg border border-blue-200 py-2 text-sm font-medium text-blue-700 active:bg-blue-50">
                      Collect from {r.shop.name}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
