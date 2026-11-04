// Small shared building blocks for every screen.

// Simple line icons (24x24, drawn with the current text colour).
const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  plus: 'M12 5v14M5 12h14',
  day: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  dues: 'M3 7h18v12H3zM15 13h3M3 7l3-3h12l3 3',
  more: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  stock: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  receive: 'M2 6h11v10H2zM13 9h4l4 4v3h-8M6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  company: 'M12 3l9 5H3l9-5zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  shops: 'M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6',
  products: 'M3 12V3h9l9 9-9 9-9-9zM8 8h.01',
  report: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  settings: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  signout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  sync: 'M20 11a8 8 0 00-14.9-3M4 13a8 8 0 0014.9 3M5 4v4h4M19 20v-4h-4',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
}

export function Icon({ name, className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={ICONS[name]} />
    </svg>
  )
}

// A Yes / No question on top of the screen.
export function ConfirmDialog({ title, children, yesLabel = 'Yes', noLabel = 'No', danger = false, onYes, onNo }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog" aria-modal="true" aria-label={title} onClick={onNo}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="space-y-2 text-sm text-gray-700">{children}</div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onNo} className="flex-1 rounded-lg border py-3 font-medium text-gray-700">
            {noLabel}
          </button>
          <button type="button" onClick={onYes}
            className={`flex-1 rounded-lg py-3 font-medium text-white ${danger ? 'bg-red-600' : 'bg-blue-600'}`}>
            {yesLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
