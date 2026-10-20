// 130 pcs, 48/carton -> "2 ctn 34 pcs"
export const fmtQty = (pieces, perCarton) => {
  const sign = pieces < 0 ? '-' : ''
  const n = Math.abs(pieces)
  if (!perCarton) return `${sign}${n} pcs`
  const c = Math.floor(n / perCarton)
  const p = n % perCarton
  if (c && p) return `${sign}${c} ctn ${p} pcs`
  if (c) return `${sign}${c} ctn`
  return `${sign}${p} pcs`
}
