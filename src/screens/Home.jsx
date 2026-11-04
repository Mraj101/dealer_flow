import { useEffect, useState } from 'react'
import { repo } from '../local'
import { Icon } from '../components/ui'
import { daysSince, fmt, fmtDate, todayDhaka } from '../lib/format'

// Today at a glance, plus shortcuts to the things done most.
export default function Home({ nav }) {
  const [today] = useState(todayDhaka())
  const [data, setData] = useState(null)

  useEffect(() => {
    const sales = repo.salesSummaryByDate(today)
    const cash = repo.dayCash(today)
    const owing = repo.duesList()
    const old = owing.filter((s) => s.oldest_due_date && daysSince(s.oldest_due_date) > 30)
    const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0)
    setData({
      sales: sales.length,
      cash: sum(sales, 'paid_amount') + cash.duesIn + cash.driverIn,
      profit: sum(sales, 'profit'),
      unpaid: sum(sales, 'still_due'),
      owedNow: repo.totalOwed(),
      owingShops: owing.length,
      oldShops: old.length,
      oldTotal: sum(old, 'balance'),
    })
  }, [today])

  if (!data) return null

  const actions = [
    { label: 'New sale', icon: 'plus', go: () => nav.root('sale'), primary: true },
    { label: 'Collect due', icon: 'dues', go: () => nav.root('dues') },
    { label: 'Receive goods', icon: 'receive', go: () => nav.go('receive') },
    { label: 'Monthly report', icon: 'report', go: () => nav.go('report') },
  ]

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-gray-500">{fmtDate(today)}</div>
        <h1 className="text-xl font-semibold">Today</h1>
      </div>

      <button type="button" onClick={() => nav.root('day')}
        className="block w-full rounded-xl bg-blue-600 p-4 text-left text-white active:bg-blue-700">
        <div className="text-sm text-blue-100">Cash in hand today</div>
        <div className="text-3xl font-bold tabular-nums">{fmt(data.cash)}</div>
        <div className="mt-2 flex justify-between text-sm text-blue-100">
          <span>{data.sales} sale{data.sales === 1 ? '' : 's'} · profit {fmt(data.profit)}</span>
          <span className="flex items-center">Day <Icon name="chevron" className="h-4 w-4" /></span>
        </div>
      </button>

      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.go}
            className={`flex items-center gap-2 rounded-xl border p-3 text-left font-medium ${
              a.primary ? 'border-blue-600 bg-blue-50 text-blue-700' : 'bg-white text-gray-800'} active:bg-gray-50`}>
            <Icon name={a.icon} /> {a.label}
          </button>
        ))}
      </div>

      <button type="button" onClick={() => nav.root('dues')}
        className="block w-full space-y-1 rounded-xl border bg-white p-3 text-left active:bg-gray-50">
        <div className="flex justify-between">
          <span className="font-medium">Shops owe you</span>
          <span className="font-semibold tabular-nums text-red-600">{fmt(data.owedNow)}</span>
        </div>
        <div className="text-sm text-gray-600">
          {data.owingShops} shop{data.owingShops === 1 ? '' : 's'}
          {data.unpaid > 0 && ` · ${fmt(data.unpaid)} from today's sales`}
        </div>
      </button>

      {data.oldShops > 0 && (
        <button type="button" onClick={() => nav.root('dues')}
          className="flex w-full items-start gap-2 rounded-xl bg-red-50 p-3 text-left text-sm text-red-800">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            <b>{data.oldShops} shop{data.oldShops === 1 ? ' has' : 's have'} owed you for more than 30 days</b>
            {' '}({fmt(data.oldTotal)}). Tap to see who.
          </span>
        </button>
      )}
    </div>
  )
}
