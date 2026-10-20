import { useState } from 'react'
import StockList from './stock/StockList'
import ReceiveGoods from './stock/ReceiveGoods'
import CompanyPayments from './stock/CompanyPayments'

const VIEWS = [
  { id: 'list', label: 'In stock', View: StockList },
  { id: 'receive', label: 'Receive', View: ReceiveGoods },
  { id: 'company', label: 'Company', View: CompanyPayments },
]

export default function Stock() {
  const [view, setView] = useState('list')
  const { View } = VIEWS.find((v) => v.id === view)

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border bg-white p-1">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${
              view === v.id ? 'bg-blue-600 text-white' : 'text-gray-600'
            }`}>
            {v.label}
          </button>
        ))}
      </div>
      <View />
    </div>
  )
}
