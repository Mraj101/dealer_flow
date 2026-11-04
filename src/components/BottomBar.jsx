import { Icon } from './ui'

// The five places you can always reach. Sale sits in the middle as a big round button.
const ITEMS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'day', label: 'Day', icon: 'day' },
  { id: 'sale', label: 'Sale', icon: 'plus', big: true },
  { id: 'dues', label: 'Dues', icon: 'dues' },
  { id: 'more', label: 'More', icon: 'more' },
]

export default function BottomBar({ active, onSelect }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md items-end border-t bg-white pb-[env(safe-area-inset-bottom)]">
      {ITEMS.map((it) => {
        const on = active === it.id
        return (
          <button key={it.id} type="button" onClick={() => onSelect(it.id)} aria-current={on ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 pb-2 pt-2 text-xs font-medium ${
              on ? 'text-blue-600' : 'text-gray-500'}`}>
            {it.big ? (
              <span className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ${
                on ? 'bg-blue-700' : 'bg-blue-600'}`}>
                <Icon name={it.icon} className="h-7 w-7" />
              </span>
            ) : (
              <Icon name={it.icon} className="h-6 w-6" />
            )}
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
