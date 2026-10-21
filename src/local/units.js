// Money is stored on the phone as whole integers in 1/10000 units, so sums are exact
// (Postgres numeric(12,4) is the widest column: unit_buy_price). 400.50 -> 4005000.
export const SCALE = 10000

// "7.5416" | 7.5416 | 400 | null -> 75416 | 75416 | 4000000 | null (exact, no float maths)
export function toUnits(v) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[2] === '' && !m[3])) throw new Error(`Not a number: ${v}`)
  const frac = (m[3] || '').padEnd(5, '0')
  let units = Number(m[2] || '0') * SCALE + Number(frac.slice(0, 4))
  if (Number(frac[4]) >= 5) units += 1 // round half away from zero at the 5th decimal
  return m[1] === '-' ? -units : units
}

// 75416 -> "7.5416", 4000000 -> "400" (for sending to Postgres)
export function toDecimalString(units) {
  if (units === null || units === undefined) return null
  const neg = units < 0
  const n = Math.abs(units)
  const whole = Math.floor(n / SCALE)
  const frac = String(n % SCALE).padStart(4, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

// 75416 -> 7.5416 (for the screens)
export const toNumber = (units) => (units === null || units === undefined ? null : units / SCALE)
