import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CompanyPayments() {
  const [bal, setBal] = useState({ paid: 0, charged: 0, balance: 0 })
  const [list, setList] = useState([])
  const [date, setDate] = useState(todayDhaka())
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const load = () => {
    supabase.from('company_balance').select('paid, charged, balance').single()
      .then(({ data }) => data && setBal(data))
    supabase.from('company_payments')
      .select('id, pay_date, amount, note')
      .is('deleted_at', null)
      .order('pay_date', { ascending: false }).order('id', { ascending: false }).limit(20)
      .then(({ data }) => setList(data || []))
  }
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault()
    const n = Number(amount)
    if (!(n > 0)) return setMsg({ type: 'err', text: 'Enter an amount above 0' })
    setSaving(true)
    const { error } = await supabase.from('company_payments').insert({
      pay_date: date, amount: n, note: note.trim() || null,
    })
    setSaving(false)
    if (error) return setMsg({ type: 'err', text: error.message })
    setAmount('')
    setNote('')
    setMsg({ type: 'ok', text: 'Payment saved' })
    load()
  }

  const input = 'w-full rounded-lg border bg-white p-3'
  const balance = Number(bal.balance)

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border bg-white p-3">
        <div className="flex justify-between"><span>Paid to company</span><span>{fmt(bal.paid)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Goods received (memo)</span><span>{fmt(bal.charged)}</span></div>
        <div className={`flex justify-between border-t pt-1 font-semibold ${balance < 0 ? 'text-red-600' : 'text-green-700'}`}>
          <span>{balance < 0 ? 'You owe company' : 'Advance left with company'}</span>
          <span>{fmt(Math.abs(balance))}</span>
        </div>
      </div>

      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount paid" className={input} />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Note (bank, cheque no., optional)" className={input} />
        <button disabled={saving}
          className="w-full rounded-lg bg-blue-600 p-3 font-medium text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save payment to company'}
        </button>
      </form>
      {msg && <p className={msg.type === 'ok' ? 'text-green-700' : 'text-red-600'}>{msg.text}</p>}

      {list.length > 0 && (
        <ul className="divide-y rounded-lg border bg-white">
          {list.map((p) => (
            <li key={p.id} className="flex justify-between p-3">
              <span>
                {p.pay_date}
                {p.note && <span className="text-sm text-gray-600"> · {p.note}</span>}
              </span>
              <span>{fmt(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
