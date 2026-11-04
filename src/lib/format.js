// Shared number and date formatting for the screens.

export const fmt = (v) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

// 'YYYY-MM-DD' -> '28 Oct 2026'
export const fmtDate = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// 'YYYY-MM-DD' -> 'Wed 28'
export const fmtDayShort = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

// 'YYYY-MM' -> 'October 2026'
export const fmtMonth = (m) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export const shiftMonth = (m, n) => {
  const t = new Date(`${m}-01T00:00:00Z`)
  t.setUTCMonth(t.getUTCMonth() + n)
  return t.toISOString().slice(0, 7)
}

export const daysSince = (d) =>
  Math.round((Date.parse(`${todayDhaka()}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000)
