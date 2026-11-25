import { useEffect, useState } from 'react'
import { repo } from '../../local'
import { ConfirmDialog, Summary } from '../../components/ui'
import { fmtDate } from '../../lib/format'
import { haptic } from '../../lib/haptics'

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
  const [confirming, setConfirming] = useState(false)

  const load = () => {
    setBal(repo.companyBalance())
    setList(repo.listCompanyPayments(20))
  }
  useEffect(() => { load() }, [])

  // check the form, then ask "are you sure?" before saving
  const askSave = (e) => {
    e.preventDefault()
    if (!(Number(amount) > 0)) {
      haptic.error()
      return setMsg({ type: 'err', text: 'Enter an amount above 0' })
    }
    setMsg(null)
    setConfirming(true)
  }

  const save = async () => {
    setConfirming(false)
    const n = Number(amount)
    setSaving(true)
    try {
      await repo.createCompanyPayment({ amount: n, note, payDate: date })
    } catch (error) {
      setSaving(false)
      haptic.error()
      return setMsg({ type: 'err', text: error.message })
    }
    setSaving(false)
    haptic.success()
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

      <form onSubmit={askSave} className="space-y-3">
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
      {confirming && (() => {
        const after = balance + Number(amount)
        return (
          <ConfirmDialog title="Save this payment to company?" yesLabel="Yes, save payment" noLabel="No, go back"
            onNo={() => setConfirming(false)} onYes={save}>
            <Summary rows={[
              ['Date', fmtDate(date)],
              ['Amount paid', fmt(amount)],
              ['Note', note.trim() || '—'],
              [after < 0 ? 'You will still owe' : 'Advance after this', fmt(Math.abs(after)),
                after < 0 ? 'text-red-600' : 'text-green-700'],
            ]} />
            <p>Are you sure these details are correct?</p>
          </ConfirmDialog>
        )
      })()}
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
