import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function DaySummary() {
  const [date, setDate] = useState(todayDhaka())
  const [rows, setRows] = useState([])
  const [duesIn, setDuesIn] = useState(0) // old dues collected on this date
  const [driverIn, setDriverIn] = useState(0) // taken from drivers for missing goods
  const [shopById, setShopById] = useState({})
  const [owedNow, setOwedNow] = useState(0) // all shops, all dates, after payments

  useEffect(() => {
    supabase.from('shops').select('id, name, area')
      .then(({ data }) => setShopById(Object.fromEntries((data || []).map((s) => [s.id, s]))))
    supabase.from('shop_balances').select('balance')
      .then(({ data }) => setOwedNow((data || []).reduce((s, b) => s + Math.max(Number(b.balance), 0), 0)))
  }, [])

  useEffect(() => {
    supabase.from('sales_summary')
      .select('id, shop_id, paid_amount, cost, total, due, profit')
      .eq('sale_date', date)
      .order('id')
      .then(({ data }) => setRows(data || []))
    supabase.from('payments')
      .select('amount')
      .eq('pay_date', date)
      .is('deleted_at', null)
      .then(({ data }) => setDuesIn((data || []).reduce((s, p) => s + Number(p.amount), 0)))
    supabase.from('receipts')
      .select('driver_paid')
      .eq('receive_date', date)
      .is('deleted_at', null)
      .then(({ data }) => setDriverIn((data || []).reduce((s, r) => s + Number(r.driver_paid), 0)))
  }, [date])

  const unpriced = rows.filter((r) => r.total === null).length
  const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0)

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Day summary</h1>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
        className="w-full rounded-lg border bg-white p-3" />

      <div className="space-y-1 rounded-lg border bg-white p-3">
        <div className="flex justify-between"><span>Collected from sales</span><span>{fmt(sum('paid_amount'))}</span></div>
        <div className="flex justify-between"><span>Old dues collected</span><span>{fmt(duesIn)}</span></div>
        {driverIn > 0 && (
          <div className="flex justify-between"><span>From driver (missing goods)</span><span>{fmt(driverIn)}</span></div>
        )}
        <div className="flex justify-between border-t pt-1 font-medium">
          <span>Total cash in hand</span><span>{fmt(sum('paid_amount') + duesIn + driverIn)}</span>
        </div>
        <div className="flex justify-between text-gray-600"><span>Cost of goods sold</span><span>{fmt(sum('cost'))}</span></div>
        <div className="flex justify-between text-gray-600"><span>Due created by today's sales</span><span>{fmt(sum('due'))}</span></div>
        <div className="flex justify-between text-gray-600">
          <span>Still owed to you (all shops, now)</span><span>{fmt(owedNow)}</span>
        </div>
        <div className={`flex justify-between text-lg font-semibold ${sum('profit') < 0 ? 'text-red-600' : 'text-green-700'}`}>
          <span>Profit</span><span>{fmt(sum('profit'))}</span>
        </div>
      </div>

      {unpriced > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {unpriced} older sale{unpriced > 1 ? 's have' : ' has'} no bill amount, so due and profit there
          are counted against buy cost only.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-center text-gray-500">No sales on this day</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {rows.map((r) => {
            const s = shopById[r.shop_id]
            return (
              <li key={r.id} className="p-3">
                <div className="flex justify-between">
                  <span>{s ? (s.area ? `${s.name} (${s.area})` : s.name) : `Shop #${r.shop_id}`}</span>
                  <span>{fmt(r.paid_amount)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>
                    Cost {fmt(r.cost)}
                    {Number(r.due) > 0 ? ` · Due ${fmt(r.due)}` : ''}
                    {r.total === null ? ' · no bill' : ''}
                  </span>
                  <span>Profit {fmt(r.profit)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
