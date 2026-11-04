import { useEffect, useState } from 'react'
import { repo } from '../local'
import { fmtQty } from '../lib/qty'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 'YYYY-MM-DD' maths without time zone surprises
const shiftDate = (d, days) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
const dayLabel = (d) => {
  const today = todayDhaka()
  if (d === today) return 'Today'
  if (d === shiftDate(today, -1)) return 'Yesterday'
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

// What happened to the money of one sale, as a small coloured label.
function statusOf(r) {
  if (r.total === null) return { text: 'No bill', tone: 'bg-gray-100 text-gray-600' }
  if (r.due <= 0) return { text: 'Paid', tone: 'bg-green-100 text-green-800' }
  if (r.still_due <= 0) return { text: 'Paid later ✓', tone: 'bg-green-100 text-green-800' }
  if (r.paid_later > 0) return { text: `Due ${fmt(r.still_due)}`, sub: `of ${fmt(r.due)}`, tone: 'bg-amber-100 text-amber-900' }
  return { text: `Due ${fmt(r.due)}`, tone: 'bg-red-100 text-red-700' }
}

// onClick makes the tile a button (with a small "›" so it looks tappable)
function Tile({ label, value, sub, tone = 'text-gray-900', onClick }) {
  const body = (
    <>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>{onClick && <span aria-hidden="true">›</span>}
      </div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-xl border bg-white p-3 text-left active:bg-gray-50">{body}</button>
  ) : (
    <div className="rounded-xl border bg-white p-3">{body}</div>
  )
}

const Row = ({ label, value, className = '' }) => (
  <div className={`flex justify-between gap-2 ${className}`}>
    <span>{label}</span><span className="tabular-nums">{value}</span>
  </div>
)

// initialDate: open on a given day (e.g. from the monthly report), otherwise today
export default function DaySummary({ onEditSale = () => {}, initialDate = null, nav }) {
  const [date, setDate] = useState(initialDate ?? todayDhaka())
  const [rows, setRows] = useState([])
  const [itemsBySale, setItemsBySale] = useState({})
  const [duesIn, setDuesIn] = useState(0) // old dues collected on this date
  const [driverIn, setDriverIn] = useState(0) // taken from drivers for missing goods
  const [shopById, setShopById] = useState({})
  const [owedNow, setOwedNow] = useState(0) // all shops, all dates, after payments
  const [openId, setOpenId] = useState(null) // the sale whose items are shown
  const [view, setView] = useState('shops') // shops | products
  const [shopQuery, setShopQuery] = useState('') // filters the shop cards by name or area

  useEffect(() => {
    setShopById(Object.fromEntries(repo.listShops({ includeDeleted: true }).map((s) => [s.id, s])))
  }, [])

  const loadDay = () => {
    setRows(repo.salesSummaryByDate(date))
    setItemsBySale(repo.saleItemsByDate(date))
    const cash = repo.dayCash(date)
    setDuesIn(cash.duesIn)
    setDriverIn(cash.driverIn)
    setOwedNow(repo.totalOwed())
  }

  useEffect(() => {
    loadDay()
    setOpenId(null)
  }, [date])

  const deleteSale = async (r) => {
    const impact = repo.deleteSaleImpact(r.id)
    const lines = [`Delete this sale to ${shopName(r)} (bill ${fmt(r.total ?? r.paid_amount)})?`]
    if (impact?.isOld) lines.push(`It is from ${impact.saleDate}, so that day's totals will change.`)
    if (impact?.paidLater > 0) {
      lines.push(`The shop already paid ${fmt(impact.paidLater)} of this sale's due later.` +
        (impact.creditAfter > 0 ? ` After deleting, the shop will have ${fmt(impact.creditAfter)} credit.` : ''))
    }
    lines.push('Stock and dues adjust by themselves.')
    if (!window.confirm(lines.join('\n\n'))) return
    try {
      await repo.deleteSale(r.id)
    } catch (e) {
      return window.alert(e.message)
    }
    setOpenId(null)
    loadDay()
  }

  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0)
  const fromSales = sum('paid_amount')
  const cashInHand = fromSales + duesIn + driverIn
  const profit = sum('profit')
  const due = sum('due')
  const stillDue = sum('still_due')
  const unpriced = rows.filter((r) => r.total === null).length
  const isToday = date === todayDhaka()

  // everything sold this day, added up per product
  const shopOfSale = Object.fromEntries(rows.map((r) => [r.id, r.shop_id]))
  const products = Object.values(
    Object.values(itemsBySale).flat().reduce((acc, it) => {
      const p = (acc[it.product_id] ??= { ...it, qty_pieces: 0, cost: 0, shops: new Set() })
      p.qty_pieces += it.qty_pieces
      p.cost += it.cost
      p.shops.add(shopOfSale[it.sale_id])
      return acc
    }, {})
  ).sort((a, b) => b.cost - a.cost)

  const shopName = (r) => shopById[r.shop_id]?.name ?? 'Unknown shop'
  const shopArea = (r) => shopById[r.shop_id]?.area
  const sq = shopQuery.trim().toLowerCase()
  const shownRows = sq
    ? rows.filter((r) => `${shopName(r)} ${shopArea(r) ?? ''}`.toLowerCase().includes(sq))
    : rows

  return (
    <div className="space-y-4">
      {/* ---------- date ---------- */}
      <div className="flex items-center gap-2">
        <button onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day"
          className="rounded-lg border bg-white px-4 py-3 text-lg leading-none">‹</button>
        <div className="relative flex-1 rounded-lg border bg-white py-2 text-center">
          <div className="font-semibold">{dayLabel(date)}</div>
          <div className="text-xs text-gray-500">{date} · tap to pick a date</div>
          {/* invisible date input on top: tapping anywhere opens the phone's date picker */}
          <input type="date" value={date} max={todayDhaka()} aria-label="Pick a date"
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </div>
        <button onClick={() => setDate(shiftDate(date, 1))} disabled={isToday} aria-label="Next day"
          className="rounded-lg border bg-white px-4 py-3 text-lg leading-none disabled:opacity-30">›</button>
      </div>

      {/* ---------- cash in hand ---------- */}
      <section className="rounded-xl bg-blue-600 p-4 text-white">
        <div className="text-sm text-blue-100">Cash in hand</div>
        <div className="text-3xl font-bold tabular-nums">{fmt(cashInHand)}</div>
        <div className="mt-2 space-y-0.5 text-sm text-blue-100">
          <Row label="From sales" value={fmt(fromSales)} />
          <Row label="Old dues collected" value={fmt(duesIn)} />
          {driverIn > 0 && <Row label="From driver (missing goods)" value={fmt(driverIn)} />}
        </div>
      </section>

      {/* ---------- the day's numbers ---------- */}
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Profit" value={fmt(profit)} tone={profit < 0 ? 'text-red-600' : 'text-green-700'} />
        <Tile label="Sold (bills)" value={fmt(sum('total'))} sub={`${rows.length} shop${rows.length === 1 ? '' : 's'}`} />
        <Tile label="Cost of goods" value={fmt(sum('cost'))} />
        <Tile label="Still unpaid" value={fmt(stillDue)} sub={due > 0 ? `of ${fmt(due)} due this day · see dues` : 'no dues this day'}
          tone={stillDue > 0 ? 'text-red-600' : 'text-gray-900'}
          onClick={due > 0 ? () => nav.go('daydues', { date }) : undefined} />
      </div>
      <div className="flex justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
        <span>All shops owe you now</span><span className="font-medium tabular-nums">{fmt(owedNow)}</span>
      </div>

      {unpriced > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {unpriced} older sale{unpriced > 1 ? 's have' : ' has'} no bill amount, so due and profit there
          are counted against buy cost only.
        </p>
      )}

      {/* ---------- shops / products ---------- */}
      {rows.length === 0 ? (
        <p className="py-8 text-center text-gray-500">No sales on this day</p>
      ) : (
        <>
          <div className="flex rounded-lg border bg-white p-1" role="tablist">
            {[['shops', `Shops (${rows.length})`], ['products', `Products (${products.length})`]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={`flex-1 rounded-md py-2 text-sm font-medium ${view === id ? 'bg-blue-600 text-white' : 'text-gray-600'}`}>
                {label}
              </button>
            ))}
          </div>

          {view === 'shops' && rows.length > 1 && (
            <div className="relative">
              <input type="text" enterKeyHint="search" value={shopQuery} onChange={(e) => setShopQuery(e.target.value)}
                placeholder="Search shop or area" aria-label="Search shops"
                className="w-full rounded-lg border bg-white p-3 pr-10" />
              {shopQuery && (
                <button type="button" onClick={() => setShopQuery('')} aria-label="Clear search"
                  className="absolute inset-y-0 right-0 px-3 text-lg text-gray-400">×</button>
              )}
            </div>
          )}

          {view === 'shops' && sq && shownRows.length === 0 && (
            <p className="py-4 text-center text-gray-500">No shop matches “{shopQuery.trim()}”</p>
          )}

          {view === 'shops' && (
            <ul className="space-y-2">
              {shownRows.map((r) => {
                const items = itemsBySale[r.id] || []
                const open = openId === r.id
                const st = statusOf(r)
                return (
                  <li key={r.id} className="overflow-hidden rounded-xl border bg-white">
                    <button onClick={() => setOpenId(open ? null : r.id)} aria-expanded={open}
                      aria-controls={`sale-${r.id}`}
                      className="flex w-full items-start gap-3 p-3 text-left transition-colors active:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{shopName(r)}</div>
                        {shopArea(r) && <div className="text-xs text-gray-500">{shopArea(r)}</div>}
                        <div className="mt-1 truncate text-sm text-gray-600">
                          {items.map((it) => `${it.name} ${fmtQty(it.qty_pieces, it.pieces_per_carton)}`).join(' · ')}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold tabular-nums">{fmt(r.total ?? r.paid_amount)}</div>
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>
                          {st.text}
                        </span>
                        {st.sub && <div className="text-xs text-gray-500">{st.sub}</div>}
                      </div>
                      <span aria-hidden="true"
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                          open ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
                          className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}>
                          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>

                    {/* slides open/closed: the grid row grows from 0 to the content's height */}
                    <div id={`sale-${r.id}`} inert={!open}
                      className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
                        open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'}`}>
                      <div className="overflow-hidden">
                      <div className="border-t bg-gray-50 p-3 text-sm">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-xs text-gray-500">
                              <th className="pb-1 font-normal">Item</th>
                              <th className="pb-1 text-right font-normal">Qty</th>
                              <th className="pb-1 text-right font-normal">Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((it) => (
                              <tr key={it.id} className="align-top">
                                <td className="py-1 pr-2">
                                  {it.name}
                                  {/* buy price as it was on this sale (kept even if the product's price changed later) */}
                                  <div className="text-xs text-gray-500">
                                    {it.pieces_per_carton} pcs/ctn · buy {Number(it.unit_buy_price)}/pc
                                  </div>
                                  {it.unit_sell_price !== null && (
                                    <div className="text-xs text-gray-500">
                                      sold @ {fmt(it.unit_sell_price)}/pc = {fmt(it.sold_for)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-1 text-right whitespace-nowrap">{fmtQty(it.qty_pieces, it.pieces_per_carton)}</td>
                                <td className="py-1 pl-2 text-right tabular-nums">{fmt(it.cost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <div className="mt-2 space-y-0.5 border-t pt-2 text-gray-700">
                          {r.total !== null && <Row label="Bill" value={fmt(r.total)} />}
                          <Row label="Collected at the sale" value={fmt(r.paid_amount)} />
                          {r.due > 0 && (
                            <>
                              <Row label="Due from this sale" value={fmt(r.due)} />
                              <Row label="Paid later" value={fmt(r.paid_later)} />
                              <Row label="Still due" value={fmt(r.still_due)}
                                className={`font-medium ${r.still_due > 0 ? 'text-red-600' : 'text-green-700'}`} />
                            </>
                          )}
                          <Row label="Cost" value={fmt(r.cost)} className="pt-1 text-gray-500" />
                          <Row label="Profit" value={fmt(r.profit)}
                            className={r.profit < 0 ? 'text-red-600' : 'text-green-700'} />
                        </div>

                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => onEditSale(r.id)}
                            className="flex-1 rounded-lg border bg-white py-2 font-medium text-blue-700 active:bg-blue-50">
                            Edit sale
                          </button>
                          <button type="button" onClick={() => deleteSale(r)}
                            className="flex-1 rounded-lg border border-red-200 bg-white py-2 font-medium text-red-600 active:bg-red-50">
                            Delete sale
                          </button>
                        </div>
                      </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {view === 'products' && (
            <div className="rounded-xl border bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="p-3 font-normal">Product</th>
                    <th className="p-3 text-right font-normal">Sold</th>
                    <th className="p-3 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {products.map((p) => (
                    <tr key={p.product_id}>
                      <td className="p-3">
                        {p.name}
                        {/* variants can share a name: their pack size and price tell them apart */}
                        <div className="text-xs text-gray-500">
                          {p.pieces_per_carton} pcs/ctn · {Number(p.unit_buy_price)}/pc
                        </div>
                        <div className="text-xs text-gray-500">{p.shops.size} shop{p.shops.size === 1 ? '' : 's'}</div>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">{fmtQty(p.qty_pieces, p.pieces_per_carton)}</td>
                      <td className="p-3 text-right tabular-nums">{fmt(p.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="p-3" colSpan={2}>Total cost</td>
                    <td className="p-3 text-right tabular-nums">{fmt(products.reduce((s, p) => s + p.cost, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
