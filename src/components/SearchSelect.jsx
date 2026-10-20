import { useState } from 'react'

// options: [{ value, label, hint? }] (hint = small grey second line); value: selected value as string ('' = none)
// disabledValues: values shown greyed out and not selectable (e.g. already used on another line)
export default function SearchSelect({ options, value, onChange, placeholder, disabledValues = [] }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selected = options.find((o) => String(o.value) === String(value))
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  const isDisabled = (o) =>
    String(o.value) !== String(value) && disabledValues.some((d) => String(d) === String(o.value))

  const pick = (o) => {
    if (isDisabled(o)) return
    onChange(String(o.value))
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        value={open ? query : selected?.label || ''}
        placeholder={placeholder}
        onFocus={() => { setQuery(''); setOpen(true) }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setOpen(false)}
        className="w-full rounded-lg border bg-white p-3"
      />
      {open && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">
          {shown.length === 0 && <li className="p-3 text-gray-500">No match</li>}
          {shown.map((o) => (
            <li
              key={o.value}
              // mousedown (not click) so it fires before the input's blur closes the list
              onMouseDown={(e) => { e.preventDefault(); pick(o) }}
              aria-disabled={isDisabled(o)}
              className={`p-3 ${
                isDisabled(o)
                  ? 'cursor-not-allowed bg-gray-50 text-gray-400'
                  : 'cursor-pointer hover:bg-gray-100'
              } ${String(o.value) === String(value) ? 'font-medium text-blue-600' : ''}`}
            >
              <div>{o.label}{isDisabled(o) && ' · already added'}</div>
              {o.hint && <div className="text-sm font-normal text-gray-500">{o.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
