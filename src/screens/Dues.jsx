import { useEffect, useState } from 'react'
import { repo } from '../local'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Dues() {
  const [rows, setRows] = useState([]) // shops that owe, with balance
  const [openId, setOpenId] = useState(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayDhaka())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => setRows(repo.duesList())
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
    </div>
  )
}
