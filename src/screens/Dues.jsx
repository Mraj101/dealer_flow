import { useEffect, useState } from 'react'
import { repo } from '../local'
import { ConfirmDialog, Icon, Summary } from '../components/ui'
import { daysSince, fmt, fmtDate, todayDhaka } from '../lib/format'
import { haptic } from '../lib/haptics'

// 0 -> 'today', 1 -> 'yesterday', 7 -> '7 days ago', 75 -> '2 months ago'
const ago = (d) => {
  const n = daysSince(d)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 60) return `${n} days ago`
  return `${Math.floor(n / 30)} months ago`
}

// How old a due is. The colours are used everywhere on this screen so they read the same.
const AGES = [
  { id: 'new', label: 'Up to 7 days', short: '≤ 7 days', test: (n) => n <= 7, bar: 'bg-gray-400', text: 'text-gray-600', stripe: 'border-l-gray-300' },
  { id: 'mid', label: '8 to 30 days', short: '8–30 days', test: (n) => n > 7 && n <= 30, bar: 'bg-amber-500', text: 'text-amber-700', stripe: 'border-l-amber-400' },
  { id: 'old', label: 'Over 30 days', short: '30+ days', test: (n) => n > 30, bar: 'bg-red-600', text: 'text-red-600', stripe: 'border-l-red-500' },
]
const ageOf = (d) => AGES.find((a) => a.test(daysSince(d)))

const SORTS = [
  { id: 'big', label: 'Biggest', by: (a, b) => b.balance - a.balance },
  { id: 'old', label: 'Oldest', by: (a, b) => (a.oldest_due_date < b.oldest_due_date ? -1 : a.oldest_due_date > b.oldest_due_date ? 1 : 0) },
  { id: 'name', label: 'A–Z', by: (a, b) => a.name.localeCompare(b.name) },
]

const chip = (on) => `whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
  on ? 'border-blue-600 bg-blue-50 font-medium text-blue-700' : 'bg-white text-gray-600'}`

// openShopId: open the Collect form for this shop straight away (e.g. from a day's dues)
export default function Dues({ openShopId = null, nav }) {
  const [rows, setRows] = useState([]) // shops that owe, with balance
  const [credits, setCredits] = useState([]) // shops that paid more than they owe
  const [openId, setOpenId] = useState(openShopId)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [confirming, setConfirming] = useState(null) // the shop whose "are you sure?" is open
  const [query, setQuery] = useState('') // filters the shops by name, area or phone
  const [sort, setSort] = useState('big')
  const [age, setAge] = useState(null) // null = all ages, else an AGES id

  const load = () => {
    setRows(repo.duesList())
    setCredits(repo.creditList())
  }
  useEffect(() => { load() }, [])
  // opened for one shop: bring it into view
  useEffect(() => {
    if (openShopId && rows.length) document.getElementById(`due-${openShopId}`)?.scrollIntoView({ block: 'center' })
  }, [openShopId, rows.length])

  const open = (id) => {
    setOpenId(openId === id ? null : id)
    setAmount('')
    setDate(todayDhaka())
    setMsg(null)
  }

  // check the amount, then ask "are you sure?" before saving
  const askSave = (shop) => {
    const n = Number(amount)
    let err = null
    if (!(n > 0)) err = 'Enter an amount above 0'
    else if (n > shop.balance + 0.004) err = `Cannot be more than the due (${fmt(shop.balance)})`
    if (err) {
      haptic.error()
      return setMsg({ type: 'err', text: err })
    }
    setMsg(null)
    setConfirming(shop)
  }

  const save = async (shop) => {
    setConfirming(null)
    const n = Number(amount)
    setSaving(true)
    try {
      await repo.createPayment({ shopId: shop.id, amount: n, payDate: date })
    } catch (error) {
      setSaving(false)
      haptic.error()
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    haptic.success()
    const left = shop.balance - n
    setMsg({
      type: 'ok',
      text: `Collected ${fmt(n)} from ${shop.name}. ${left > 0.004 ? `Still owes ${fmt(left)}.` : 'All cleared ✓'}`,
    })
    setOpenId(null)
    setAmount('')
    load()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------- numbers for the top card ----------
  const total = rows.reduce((s, r) => s + r.balance, 0)
  const byAge = AGES.map((a) => ({
    ...a,
    amount: rows.reduce((s, r) => s + r.unpaid_sales
      .filter((u) => a.test(daysSince(u.sale_date))).reduce((t, u) => t + u.still_due, 0), 0),
    shops: rows.filter((r) => r.unpaid_sales.some((u) => a.test(daysSince(u.sale_date)))).length,
  }))

  // ---------- what the list shows ----------
  const q = query.trim().toLowerCase()
  const matches = (s) => !q || [s.name, s.area, s.phone].filter(Boolean).join(' ').toLowerCase().includes(q)
  const ofAge = (s) => !age || s.unpaid_sales.some((u) => AGES.find((a) => a.id === age).test(daysSince(u.sale_date)))
  const shownRows = rows.filter((s) => matches(s) && ofAge(s)).sort(SORTS.find((x) => x.id === sort).by)
  const shownCredits = credits.filter(matches)
  const filtered = Boolean(q || age)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dues</h1>

      {msg?.type === 'ok' && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-green-800">
          <span aria-hidden="true">✓</span>
          <span className="flex-1">{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss" className="px-1 text-green-700">×</button>
        </div>
      )}

      {/* ---------- total and how old it is ---------- */}
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-sm text-gray-500">Total to collect</div>
            <div className={`text-3xl font-bold tabular-nums ${total > 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(total)}</div>
          </div>
          <div className="text-right text-sm text-gray-500">
            {rows.length} shop{rows.length === 1 ? '' : 's'} owe{rows.length === 1 ? 's' : ''}
          </div>
        </div>

        {total > 0 && (
          <>
            {/* one bar split by age: the redder, the older the money */}
            <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              {byAge.map((a) => a.amount > 0 && (
                <div key={a.id} className={a.bar} style={{ width: `${(a.amount / total) * 100}%` }} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {byAge.map((a) => (
                <button key={a.id} type="button" onClick={() => setAge(age === a.id ? null : a.id)}
                  aria-pressed={age === a.id} disabled={a.shops === 0}
                  className={`rounded-lg border p-2 text-left disabled:opacity-40 ${
                    age === a.id ? 'border-blue-600 bg-blue-50' : 'bg-white'}`}>
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <span className={`h-2 w-2 rounded-full ${a.bar}`} />{a.short}
                  </div>
                  <div className={`text-sm font-semibold tabular-nums ${a.amount > 0 ? a.text : 'text-gray-400'}`}>{fmt(a.amount)}</div>
                  <div className="text-xs text-gray-500">{a.shops} shop{a.shops === 1 ? '' : 's'}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---------- search, sort ---------- */}
      {(rows.length > 0 || credits.length > 0) && (
        <div className="space-y-2">
          <div className="relative">
            <input type="text" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shop, area or phone" aria-label="Search shops"
              className="w-full rounded-lg border bg-white p-3 pr-10" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute inset-y-0 right-0 px-3 text-lg text-gray-400">×</button>
            )}
          </div>
          {rows.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-sm text-gray-500">Sort</span>
              {SORTS.map((x) => (
                <button key={x.id} type="button" onClick={() => setSort(x.id)} aria-pressed={sort === x.id}
                  className={chip(sort === x.id)}>{x.label}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {filtered && rows.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1 text-sm text-gray-600">
          <span>
            {shownRows.length} of {rows.length} shops
            {age && <> · {AGES.find((a) => a.id === age).label.toLowerCase()}</>}
          </span>
          <span>owe <b className="text-red-600">{fmt(shownRows.reduce((s, r) => s + r.balance, 0))}</b></span>
        </div>
      )}
      {age && (
        <button type="button" onClick={() => setAge(null)} className="-mt-2 px-1 text-sm text-blue-600">Show all ages</button>
      )}

      {/* ---------- the shops ---------- */}
      {rows.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-center">
          <div className="text-3xl">🎉</div>
          <p className="mt-1 font-medium text-gray-700">No shop owes you anything</p>
        </div>
      ) : shownRows.length === 0 ? (
        <p className="py-4 text-center text-gray-500">
          {q ? <>No shop with dues matches “{query.trim()}”</> : 'No shop in this group'}
        </p>
      ) : (
        <ul className="space-y-3">
          {shownRows.map((s) => {
            const a = s.oldest_due_date ? ageOf(s.oldest_due_date) : AGES[0]
            const isOpen = openId === s.id
            const n = Number(amount) || 0
            const after = s.balance - n
            return (
              <li key={s.id} id={`due-${s.id}`}
                className={`rounded-xl border border-l-4 bg-white ${a.stripe} ${isOpen ? 'ring-2 ring-blue-200' : ''}`}>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{s.name}</div>
                      {s.area && <div className="truncate text-sm text-gray-600">{s.area}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-bold tabular-nums text-red-600">{fmt(s.balance)}</div>
                    </div>
                  </div>
                  {s.oldest_due_date && (
                    <div className={`mt-1 text-xs ${a.text}`}>
                      Due since {fmtDate(s.oldest_due_date)} · {ago(s.oldest_due_date)}
                      {s.unpaid_sales.length > 1 && <span className="text-gray-500"> · {s.unpaid_sales.length} unpaid sales</span>}
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => open(s.id)} aria-expanded={isOpen}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-medium ${
                        isOpen ? 'border bg-white text-gray-700' : 'bg-blue-600 text-white'}`}>
                      {!isOpen && <Icon name="cash" className="h-4 w-4" />}
                      {isOpen ? 'Close' : 'Collect'}
                    </button>
                    <button type="button" onClick={() => nav.go('shop', { shopId: s.id })} aria-label={`History of ${s.name}`}
                      className="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 active:bg-gray-50">
                      <Icon name="history" className="h-4 w-4" /> History
                    </button>
                    {s.phone && (
                      <a href={`tel:${s.phone}`} aria-label={`Call ${s.name}`}
                        className="flex items-center justify-center rounded-lg border px-3 py-2 text-green-700 active:bg-green-50">
                        <Icon name="phone" className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="space-y-3 border-t bg-gray-50/60 p-3">
                    <div className="rounded-lg border bg-white p-2 text-sm">
                      <div className="mb-1 text-xs font-medium text-gray-500">Unpaid sales, oldest first</div>
                      <ul className="divide-y">
                        {s.unpaid_sales.map((u) => (
                          <li key={u.id} className="flex justify-between gap-2 py-1.5">
                            <span>
                              {fmtDate(u.sale_date)} <span className={`text-xs ${ageOf(u.sale_date).text}`}>· {ago(u.sale_date)}</span>
                            </span>
                            <span className="tabular-nums">
                              {fmt(u.still_due)}
                              {u.still_due < u.due && <span className="text-xs text-gray-500"> of {fmt(u.due)}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-gray-500">Money you collect clears the oldest sale first.</p>
                    </div>

                    <div>
                      <label htmlFor={`amt-${s.id}`} className="block text-sm font-medium text-gray-900">Amount received</label>
                      <input id={`amt-${s.id}`} inputMode="decimal" value={amount} placeholder="Amount received"
                        onChange={(e) => { setAmount(e.target.value); setMsg(null) }}
                        className="mt-1 w-full rounded-lg border bg-white p-3 text-lg" />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => setAmount(String(s.balance))}
                          className={chip(n === s.balance)}>Full due {fmt(s.balance)}</button>
                        {s.unpaid_sales.length > 1 && (
                          <button type="button" onClick={() => setAmount(String(s.unpaid_sales[0].still_due))}
                            className={chip(n === s.unpaid_sales[0].still_due)}>
                            Oldest sale {fmt(s.unpaid_sales[0].still_due)}
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label htmlFor={`date-${s.id}`} className="block text-sm font-medium text-gray-900">Date received</label>
                      <input id={`date-${s.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border bg-white p-3" />
                    </div>

                    {n > 0 && (
                      <div className={`flex justify-between rounded-lg p-2 text-sm font-medium ${
                        after < -0.004 ? 'bg-red-50 text-red-700' : after > 0.004 ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-800'}`}>
                        <span>{after < -0.004 ? 'More than the due' : 'Will still owe after this'}</span>
                        <span className="tabular-nums">{after < -0.004 ? fmt(-after) : after > 0.004 ? fmt(after) : 'Nothing ✓'}</span>
                      </div>
                    )}

                    {msg?.type === 'err' && <p className="text-sm text-red-600">{msg.text}</p>}
                    <button type="button" onClick={() => askSave(s)} disabled={saving}
                      className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save payment'}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {confirming && (
        <ConfirmDialog title="Save this payment?" yesLabel="Yes, save payment" noLabel="No, go back"
          onNo={() => setConfirming(null)} onYes={() => save(confirming)}>
          <Summary rows={[
            ['Shop', confirming.name],
            ['Date', fmtDate(date)],
            ['Owed before', fmt(confirming.balance)],
            ['Amount received', fmt(amount), 'text-green-700'],
            ['Still owed after', fmt(confirming.balance - Number(amount)),
              confirming.balance - Number(amount) > 0.004 ? 'text-red-600' : 'text-green-700'],
          ]} />
          <p>Are you sure you received this money?</p>
        </ConfirmDialog>
      )}

      {/* ---------- shops in credit ---------- */}
      {shownCredits.length > 0 && (
        <section className="space-y-2 pt-2">
          <h2 className="font-semibold">Shops with credit</h2>
          <p className="text-sm text-gray-600">
            These shops paid more than they owe, for example a sale they had paid for was deleted.
            Their credit is used up automatically by their next unpaid sale.
          </p>
          <ul className="space-y-2">
            {shownCredits.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => nav.go('shop', { shopId: c.id })}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-l-4 border-l-green-500 bg-white p-3 text-left active:bg-gray-50">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    {(c.area || c.phone) && (
                      <span className="block truncate text-sm text-gray-600">{[c.area, c.phone].filter(Boolean).join(' · ')}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold text-green-700">Credit {fmt(c.credit)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
