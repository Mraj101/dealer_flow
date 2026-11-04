import { Icon } from '../components/ui'

// Everything that isn't in the bottom bar. New modules get a tile here.
const GROUPS = [
  {
    title: 'Stock',
    items: [
      { page: 'stock', label: 'In stock', note: 'What is left of each product', icon: 'stock' },
      { page: 'receive', label: 'Receive goods', note: 'A delivery from the company', icon: 'receive' },
      { page: 'company', label: 'Company payments', note: 'Money paid to the company', icon: 'company' },
    ],
  },
  {
    title: 'Lists',
    items: [
      { page: 'shops', label: 'Shops', note: 'Add and see your shops', icon: 'shops' },
      { page: 'products', label: 'Products', note: 'Prices and pieces per carton', icon: 'products' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { page: 'report', label: 'Monthly report', note: 'Sales, cash and profit by month', icon: 'report' },
    ],
  },
  {
    title: 'App',
    items: [
      { page: 'settings', label: 'Settings', note: 'Sync, account, sign out', icon: 'settings' },
    ],
  },
]

export default function More({ nav }) {
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">More</h1>
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">{g.title}</h2>
          <div className="grid grid-cols-2 gap-2">
            {g.items.map((it) => (
              <button key={it.page} type="button" onClick={() => nav.go(it.page)}
                className="flex flex-col items-start gap-2 rounded-xl border bg-white p-3 text-left active:bg-gray-50">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon name={it.icon} />
                </span>
                <span>
                  <span className="block font-medium">{it.label}</span>
                  <span className="block text-xs text-gray-500">{it.note}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
