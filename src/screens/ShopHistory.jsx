import { useState } from 'react'
import { repo } from '../local'
import { fmtQty } from '../lib/qty'
import { daysSince, fmt, fmtDate, todayDhaka } from '../lib/format'

// 'YYYY-MM-DD' that is n months before today (for the period filter)
const monthsBack = (n) => {
  const t = new Date(`${todayDhaka()}T00:00:00Z`)
  t.setUTCMonth(t.getUTCMonth() - n)
  return t.toISOString().slice(0, 10)
}
const PERIODS = [
  { id: 'month', label: 'This month', from: () => `${todayDhaka().slice(0, 7)}-01` },
  { id: '3m', label: '3 months', from: () => monthsBack(3) },
  { id: 'all', label: 'Everything', from: () => '' },
]

const ago = (d) => {
  const n = daysSince(d)
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 60 ? `${n} days ago` : `${Math.floor(n / 30)} months ago`
}
const entered = (iso) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
const short = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// what happened to a sale's money, as a coloured label
function saleStatus(e) {
  if (e.bill === null) return { text: 'No bill', tone: 'bg-gray-100 text-gray-600' }
  if (e.due <= 0) return { text: 'Paid at sale', tone: 'bg-green-100 text-green-800' }
  if (e.still_due <= 0.004) return { text: 'Paid later ✓', tone: 'bg-green-100 text-green-800' }
  if (e.paid_later > 0) return { text: `Part paid · ${fmt(e.still_due)} left`, tone: 'bg-amber-100 text-amber-900' }
  return { text: `Unpaid ${fmt(e.due)}`, tone: 'bg-red-100 text-red-700' }
}

const Row = ({ label, value, className = '' }) => (
  <div className={`flex justify-between gap-2 ${className}`}>
    <span>{label}</span><span className="tabular-nums">{value}</span>
  </div>
)

function SaleCard({ e, open, onToggle, onEditSale }) {
  const st = saleStatus(e)
  return (
    <li className="rounded-xl border bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">SALE</span>
              <span className="font-medium">{e.bill === null ? 'No bill amount' : `Bill ${fmt(e.bill)}`}</span>
            </div>
            <div className="mt-1 truncate text-sm text-gray-600">
              {e.items.map((it) => `${it.name} ${fmtQty(it.qty_pieces, it.pieces_per_carton)}`).join(' · ') || 'No items'}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>{st.text}</span>
            <div className="mt-1 text-xs text-gray-500">owes after: <b className="tabular-nums">{fmt(e.balance)}</b></div>
          </div>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 pb-3 pt-2 text-sm">
          <ul className="space-y-1">
            {e.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {it.name} <span className="text-gray-500">· {fmtQty(it.qty_pieces, it.pieces_per_carton)}
                    {it.unit_sell_price !== null && ` × ${it.unit_sell_price}`}</span>
                </span>
                <span className="tabular-nums">{it.sold_for === null ? '—' : fmt(it.sold_for)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-0.5 rounded-lg bg-gray-50 p-2">
            <Row label="Bill" value={e.bill === null ? '—' : fmt(e.bill)} />
            <Row label="Collected at the sale" value={fmt(e.paid_at_sale)} />
            <Row label="Left as due" value={fmt(e.due)} className={e.due > 0 ? 'font-medium' : ''} />
            {e.paid_by.map((x) => (
              <Row key={x.payment_id} label={`↳ paid on ${fmtDate(x.pay_date)}`} value={`−${fmt(x.amount)}`}
                className="text-green-700" />
            ))}
            {e.due > 0 && (
              <Row label="Still due on this sale" value={fmt(e.still_due)}
                className={`border-t pt-1 font-semibold ${e.still_due > 0.004 ? 'text-red-600' : 'text-green-700'}`} />
            )}
          </div>

          <div className="flex justify-between text-gray-600">
            <span>Cost {fmt(e.cost)}</span>
            <span className={e.profit < 0 ? 'text-red-600' : 'text-green-700'}>Profit {fmt(e.profit)}</span>
          </div>
          <div className="text-xs text-gray-400">Entered {entered(e.created_at)}</div>

          <button type="button" onClick={() => onEditSale(e.id)}
            className="w-full rounded-lg border py-2 font-medium text-blue-700 active:bg-blue-50">
            Open / edit this sale
          </button>
        </div>
      )}
    </li>
  )
}

function PaymentCard({ e }) {
  return (
    <li className="rounded-xl border border-green-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-semibold text-green-700">COLLECTED</span>
            <span className="font-medium text-green-700">{fmt(e.amount)}</span>
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {e.cleared.length > 0
              ? <>Paid off: {e.cleared.map((c) => `${short(c.sale_date)} sale ${fmt(c.amount)}`).join(' · ')}</>
              : 'Kept as credit'}
            {e.cleared.length > 0 && e.credit > 0.004 && ` · ${fmt(e.credit)} kept as credit`}
          </div>
          <div className="mt-0.5 text-xs text-gray-400">Entered {entered(e.created_at)}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-gray-500">
          owes after: <b className="tabular-nums">{fmt(e.balance)}</b>
        </div>
      </div>
    </li>
  )
}

// Every sale to a shop and every due collected from it, newest first, with what the shop owed after each.
export default function ShopHistory({ shopId, nav, onEditSale = () => {} }) {
  // read straight away (it is a quick local query), so the page never flashes "not found"
  const [data] = useState(() => repo.shopHistory(shopId))
  const [period, setPeriod] = useState('3m')
  const [openId, setOpenId] = useState(null)

  if (!data) return <p className="py-8 text-center text-gray-500">Shop not found</p>

  const from = PERIODS.find((p) => p.id === period).from()
  const all = data.events
  const inPeriod = all.filter((e) => e.date >= from)
  const before = all.filter((e) => e.date < from)
  const startBal = before.length ? before[before.length - 1].balance : 0

  const sales = inPeriod.filter((e) => e.kind === 'sale')
  const pays = inPeriod.filter((e) => e.kind === 'payment')
  const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0)
  const sold = sum(sales, (e) => e.bill)
  const atSale = sum(sales, (e) => e.paid_at_sale)
  const later = sum(pays, (e) => e.amount)
  const profit = sum(sales, (e) => e.profit)

  // newest first, grouped by day
  const days = []
  for (const e of [...inPeriod].reverse()) {
    const last = days[days.length - 1]
    if (last?.date === e.date) last.events.push(e)
    else days.push({ date: e.date, events: [e] })
  }

  const { shop, balance } = data
  const owes = balance > 0.004
  const credit = balance < -0.004

  return (
    <div className="space-y-4">
      {/* ---------- who and how much now ---------- */}
      <section className="space-y-2 rounded-xl border bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-lg font-semibold">{shop.name}</div>
            <div className="text-sm text-gray-600">
              {shop.area}
              {shop.area && shop.phone && ' · '}
              {shop.phone && <a href={`tel:${shop.phone}`} className="text-blue-600">{shop.phone}</a>}
              {shop.deleted && <span className="text-red-600"> · removed shop</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs text-gray-500">{owes ? 'Owes you now' : credit ? 'Credit now' : 'Owes now'}</div>
            <div className={`text-xl font-bold tabular-nums ${owes ? 'text-red-600' : 'text-green-700'}`}>
              {owes || credit ? fmt(Math.abs(balance)) : 'Nothing ✓'}
            </div>
          </div>
        </div>
        {owes && !shop.deleted && (
          <button type="button" onClick={() => nav.go('dues', { openShopId: shop.id })}
            className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white">
            Collect from {shop.name}
          </button>
        )}
      </section>

      {/* ---------- period ---------- */}
      <div className="flex gap-2" role="tablist">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={period === p.id} onClick={() => setPeriod(p.id)}
            className={`flex-1 rounded-full border px-3 py-1.5 text-sm ${
              period === p.id ? 'border-blue-600 bg-blue-50 font-medium text-blue-700' : 'bg-white text-gray-600'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <section className="space-y-1 rounded-xl border bg-white p-3 text-sm">
        {from && <Row label={`Owed before ${fmtDate(from)}`} value={fmt(startBal)} className="text-gray-500" />}
        <Row label={`Sold (${sales.length} sale${sales.length === 1 ? '' : 's'})`} value={fmt(sold)} />
        <Row label="Collected at the sales" value={fmt(atSale)} className="text-gray-600" />
        <Row label={`Dues collected later (${pays.length}×)`} value={fmt(later)} className="text-gray-600" />
        <Row label="Profit" value={fmt(profit)} className={profit < 0 ? 'text-red-600' : 'text-green-700'} />
        <Row label="Owes now" value={fmt(balance)}
          className={`border-t pt-1 font-semibold ${owes ? 'text-red-600' : 'text-green-700'}`} />
      </section>

      {/* ---------- timeline ---------- */}
      {days.length === 0 ? (
        <p className="py-6 text-center text-gray-500">
          {all.length ? 'Nothing in this period. Try “Everything”.' : 'No sales or collections with this shop yet.'}
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <div key={d.date} className="space-y-2">
              <div className="px-1 text-sm font-semibold text-gray-700">
                {fmtDate(d.date)} <span className="font-normal text-gray-500">· {ago(d.date)}</span>
              </div>
              <ul className="space-y-2">
                {d.events.map((e) => (e.kind === 'sale'
                  ? <SaleCard key={e.id} e={e} open={openId === e.id}
                      onToggle={() => setOpenId(openId === e.id ? null : e.id)} onEditSale={onEditSale} />
                  : <PaymentCard key={e.id} e={e} />))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
