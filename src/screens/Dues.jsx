import { useEffect, useState } from 'react'
import { repo } from '../local'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 'YYYY-MM-DD' -> '28 Oct 2026'
const fmtDate = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const daysSince = (d) =>
  Math.round((Date.parse(`${todayDhaka()}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000)
// 0 -> 'today', 1 -> 'yesterday', 7 -> '7 days ago', 75 -> '2 months ago'
const ago = (d) => {
  const n = daysSince(d)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n < 60) return `${n} days ago`
  return `${Math.floor(n / 30)} months ago`
}
// older dues stand out more
const ageTone = (d) => (daysSince(d) > 30 ? 'text-red-600' : daysSince(d) > 7 ? 'text-amber-700' : 'text-gray-500')

export default function Dues() {
  const [rows, setRows] = useState([]) // shops that owe, with balance
  const [credits, setCredits] = useState([]) // shops that paid more than they owe
  const [openId, setOpenId] = useState(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => {
    setRows(repo.duesList())
    setCredits(repo.creditList())
  }
  useEffect(() => { load() }, [])

  const open = (id) => {
    setOpenId(openId === id ? null : id)
    setAmount('')
    setMsg(null)
  }

  const save = async (shop) => {
    const n = Number(amount)
    if (!(n > 0)) return setMsg({ type: 'err', text: 'Enter an amount above 0' })
    if (n > shop.balance) return setMsg({ type: 'err', text: `Cannot be more than the due (${fmt(shop.balance)})` })
    setSaving(true)
    try {
      await repo.createPayment({ shopId: shop.id, amount: n, payDate: date })
    } catch (error) {
      setSaving(false)
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    setMsg({ type: 'ok', text: `Collected ${fmt(n)} from ${shop.name}` })
    setOpenId(null)
    setAmount('')
    load()
  }

  const total = rows.reduce((s, r) => s + r.balance, 0)
  const input = 'w-full rounded-lg border bg-white p-3'

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dues</h1>
      <div className="flex justify-between rounded-lg border bg-white p-3 font-medium">
        <span>Total to collect</span><span className="text-red-600">{fmt(total)}</span>
      </div>
      {msg && openId === null && (
        <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>
      )}
      {rows.length === 0 ? (
        <p className="text-center text-gray-500">No shop owes you anything</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {rows.map((s) => (
            <li key={s.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div>{s.name}</div>
                  <div className="text-sm text-gray-600">
                    {[s.area, s.phone].filter(Boolean).join(' · ')}
                  </div>
                  {s.oldest_due_date && (
                    <div className={`text-xs ${ageTone(s.oldest_due_date)}`}>
                      Due since {fmtDate(s.oldest_due_date)} · {ago(s.oldest_due_date)}
                      {s.unpaid_sales.length > 1 && ` · ${s.unpaid_sales.length} unpaid sales`}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-medium text-red-600">{fmt(s.balance)}</div>
                  <button onClick={() => open(s.id)} className="text-sm text-blue-600">
                    {openId === s.id ? 'Close' : 'Collect'}
                  </button>
                </div>
              </div>
              {openId === s.id && (
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg bg-gray-50 p-2 text-sm">
                    <div className="mb-1 text-xs font-medium text-gray-500">Unpaid sales, oldest first</div>
                    <ul className="space-y-1">
                      {s.unpaid_sales.map((u) => (
                        <li key={u.id} className="flex justify-between gap-2">
                          <span>
                            {fmtDate(u.sale_date)} <span className={`text-xs ${ageTone(u.sale_date)}`}>· {ago(u.sale_date)}</span>
                          </span>
                          <span className="tabular-nums">
                            {fmt(u.still_due)}
                            {u.still_due < u.due && <span className="text-xs text-gray-500"> of {fmt(u.due)}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <input inputMode="decimal" value={amount} placeholder="Amount received"
                    onChange={(e) => setAmount(e.target.value)} className={input} />
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
                  {msg?.type === 'err' && <p className="text-red-600">{msg.text}</p>}
                  <button onClick={() => save(s)} disabled={saving}
                    className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save payment'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {credits.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Shops with credit</h2>
          <p className="text-sm text-gray-600">
            These shops paid more than they owe, for example a sale they had paid for was deleted.
            Their credit is used up automatically by their next unpaid sale.
          </p>
          <ul className="divide-y rounded-lg border bg-white">
            {credits.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 p-3">
                <div>
                  <div>{c.name}</div>
                  {(c.area || c.phone) && (
                    <div className="text-sm text-gray-600">{[c.area, c.phone].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
                <div className="font-medium text-green-700">Credit {fmt(c.credit)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
