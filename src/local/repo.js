import { TABLES } from './schema.js'
import { toUnits, toNumber } from './units.js'

const nowIso = () => new Date().toISOString()
export const todayDhaka = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })

// uuid v4 that also works on http:// pages (crypto.randomUUID needs https)
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// numeric(12,2) like the server: money typed in the app is rounded to 2 decimals
const round2 = (units) => (units === null ? null : Math.round(units / 100) * 100)

const fail = (message, code) => Object.assign(new Error(message), code ? { code } : {})

// The phone-side version of the create_sale / create_receipt functions and the
// queries the screens use. Reads return plain numbers; writes mark rows dirty so
// sync sends them.
export function createRepo(driver) {
  const userId = () => {
    const id = driver.meta('user_id')
    if (!id) throw fail('Not signed in')
    return id
  }

  const insertRow = (table, values) => {
    const now = nowIso()
    const row = { id: uuid(), user_id: userId(), status: 1, created_at: now, updated_at: now, ...values }
    const cols = TABLES[table].map(([c]) => c)
    driver.run(
      `insert into ${table} (${cols.join(',')}, _dirty, _ver) values (${cols.map(() => '?').join(',')}, 1, 1)`,
      cols.map((c) => row[c] ?? null)
    )
    return row.id
  }

  const updateRow = (table, id, patch) => {
    const cols = Object.keys({ ...patch, updated_at: 0 })
    driver.run(
      `update ${table} set ${cols.map((c) => `${c} = ?`).join(', ')}, _dirty = 1, _ver = _ver + 1, _error = null where id = ?`,
      [...cols.map((c) => (c === 'updated_at' ? nowIso() : patch[c] ?? null)), id]
    )
  }

  const money = (rows, fields) =>
    rows.map((r) => {
      const o = { ...r }
      for (const f of fields) o[f] = toNumber(r[f])
      return o
    })

  const done = async (result) => {
    await driver.persist()
    return result
  }

  // All of a shop's later payments, applied to its sales' dues oldest first (in 1/10000 units).
  // Returns { [saleId]: { paidLater, stillDue } } for every sale of the shop that created a due.
  const settleShopDues = (shopId) => {
    const sales = driver.all(
      `select ss.id, ss.due, ss.sale_date from sales_summary ss join sales s on s.id = ss.id
       where ss.shop_id = ? and ss.due > 0 order by ss.sale_date, s.created_at, s.rowid`,
      [shopId]
    )
    let left = driver.get(
      `select coalesce(sum(amount), 0) as v from payments
       where shop_id = ? and deleted_at is null and status = 1`,
      [shopId]
    ).v
    const out = {}
    for (const s of sales) {
      const paid = Math.min(s.due, left)
      left -= paid
      out[s.id] = { paidLater: paid, stillDue: s.due - paid, saleDate: s.sale_date }
    }
    return out
  }

  // The rules for a new or edited sale (same as the server's create_sale).
  // keep: the sale's current lines by id (edits only); a line that keeps its id and product
  // keeps its original buy price, even if that product was deleted since.
  const checkSale = ({ shopId, billAmount, paidAmount, items }, keep = {}) => {
    if (!driver.get('select 1 as x from shops where id = ? and deleted_at is null', [shopId])) {
      throw fail('Shop not found')
    }
    if (!Array.isArray(items) || items.length === 0) throw fail('Add at least one line')

    const lines = items.map((it) => {
      const qty = Number(it.qtyPieces)
      const price = toUnits(it.unitSellPrice)
      if (!it.productId || !Number.isInteger(qty) || qty <= 0 || (price !== null && price < 0)) {
        throw fail('Every line needs a product and quantity above 0')
      }
      const old = it.itemId ? keep[it.itemId] : null
      if (old && old.product_id === it.productId) {
        return { itemId: it.itemId, productId: it.productId, qty, price, buy: old.unit_buy_price }
      }
      const p = driver.get('select unit_buy_price from products where id = ? and deleted_at is null', [it.productId])
      if (!p) throw fail('Unknown product in lines')
      return { itemId: null, productId: it.productId, qty, price, buy: p.unit_buy_price }
    })

    let bill = round2(toUnits(billAmount))
    if (bill === null) {
      bill = lines.some((l) => l.price === null)
        ? null
        : round2(lines.reduce((s, l) => s + l.qty * l.price, 0))
    }
    if (bill === null || bill < 0) throw fail('Enter the bill amount')

    const paid = paidAmount === null || paidAmount === undefined ? bill : round2(toUnits(paidAmount))
    if (paid === null || paid < 0 || paid > bill) throw fail('Money collected must be between 0 and the bill amount')
    return { lines, bill, paid }
  }

  // ---------- shops ----------
  const shopExists = (name, area) =>
    driver.get(
      `select 1 as x from shops where deleted_at is null
         and lower(name) = lower(?) and lower(coalesce(area, '')) = lower(?)`,
      [name, area || '']
    )

  return {
    uuid,
    driver,

    // includeDeleted: for showing the name of a shop that was removed after it made sales
    listShops({ sort = 'name', includeDeleted = false } = {}) {
      const order = sort === 'area' ? 'area is null, lower(area), lower(name)' : 'lower(name)'
      return driver.all(
        `select id, name, area, phone from shops ${includeDeleted ? '' : 'where deleted_at is null'} order by ${order}`)
    },

    async addShop({ name, area, phone }) {
      const n = (name || '').trim()
      if (!n) throw fail('Enter a shop name')
      const a = (area || '').trim() || null
      if (shopExists(n, a)) throw fail('This shop already exists in this area', '23505')
      const id = driver.transaction(() =>
        insertRow('shops', { name: n, area: a, phone: (phone || '').trim() || null }))
      return done(id)
    },

    // ---------- products ----------
    listProducts({ activeOnly = false } = {}) {
      const rows = driver.all(
        `select id, name, pieces_per_carton, unit_buy_price, unit_mrp from products
         where deleted_at is null ${activeOnly ? 'and status = 1' : ''} order by lower(name)`
      )
      return money(rows, ['unit_buy_price', 'unit_mrp'])
    },

    async saveProduct({ id, name, pieces_per_carton, unit_buy_price, unit_mrp }) {
      const n = (name || '').trim()
      const perCarton = Number(pieces_per_carton)
      if (!n) throw fail('Enter a product name')
      if (!Number.isInteger(perCarton) || perCarton <= 0) throw fail('Pieces per carton must be above 0')
      const buy = toUnits(unit_buy_price)
      if (buy === null || buy < 0) throw fail('Enter the buy price per piece')
      const mrp = toUnits(unit_mrp)
      if (mrp !== null && mrp < 0) throw fail('MRP cannot be negative')
      const values = { name: n, pieces_per_carton: perCarton, unit_buy_price: buy, unit_mrp: mrp }
      const savedId = driver.transaction(() => {
        if (id) { updateRow('products', id, values); return id }
        return insertRow('products', values)
      })
      return done(savedId)
    },

    async deleteProduct(id) {
      driver.transaction(() => updateRow('products', id, { deleted_at: nowIso() }))
      return done()
    },

    // ---------- sales ----------
    // items: [{ productId, qtyPieces, unitSellPrice | null }]
    // billAmount: null = sum of line prices (every line needs one); paidAmount: null = paid in full
    async createSale(input) {
      const { lines, bill, paid } = checkSale(input)
      const saleId = driver.transaction(() => {
        const id = insertRow('sales', {
          shop_id: input.shopId, sale_date: input.saleDate || todayDhaka(), bill_amount: bill, paid_amount: paid,
        })
        for (const l of lines) {
          insertRow('sale_items', {
            sale_id: id, product_id: l.productId, qty_pieces: l.qty,
            unit_sell_price: l.price, unit_buy_price: l.buy,
          })
        }
        return id
      })
      return done(saleId)
    },

    // One sale with its lines, for the edit screen. Each line carries its product (even a deleted one).
    getSale(id) {
      const s = driver.get(
        'select id, shop_id, sale_date, bill_amount, paid_amount from sales where id = ? and deleted_at is null', [id])
      if (!s) return null
      const items = driver.all(
        `select i.id, i.product_id, i.qty_pieces, i.unit_sell_price, i.unit_buy_price,
                p.name, p.pieces_per_carton, p.unit_buy_price as current_buy, p.unit_mrp
         from sale_items i left join products p on p.id = i.product_id
         where i.sale_id = ? and i.deleted_at is null order by i.rowid`, [id])
      return {
        id: s.id,
        shop_id: s.shop_id,
        sale_date: s.sale_date,
        bill_amount: toNumber(s.bill_amount),
        paid_amount: toNumber(s.paid_amount),
        items: items.map((i) => ({
          id: i.id,
          product_id: i.product_id,
          qty_pieces: i.qty_pieces,
          unit_sell_price: toNumber(i.unit_sell_price),
          unit_buy_price: toNumber(i.unit_buy_price),
          product: {
            id: i.product_id,
            name: i.name ?? '(unknown product)',
            pieces_per_carton: i.pieces_per_carton,
            unit_buy_price: toNumber(i.current_buy),
            unit_mrp: toNumber(i.unit_mrp),
          },
        })),
      }
    },

    // Edit a sale in place. items: [{ itemId?, productId, qtyPieces, unitSellPrice }]
    // A line sent back with its itemId (same product) keeps its original buy price; lines left out
    // are marked deleted; lines without an itemId are new and take today's buy price.
    async updateSale(id, input) {
      const existing = driver.all(
        `select id, product_id, qty_pieces, unit_sell_price, unit_buy_price from sale_items
         where sale_id = ? and deleted_at is null`, [id])
      if (!driver.get('select 1 as x from sales where id = ? and deleted_at is null', [id])) throw fail('Sale not found')
      const keep = Object.fromEntries(existing.map((r) => [r.id, r]))
      const { lines, bill, paid } = checkSale(input, keep)
      driver.transaction(() => {
        updateRow('sales', id, {
          shop_id: input.shopId, sale_date: input.saleDate || todayDhaka(), bill_amount: bill, paid_amount: paid,
        })
        const kept = new Set(lines.filter((l) => l.itemId).map((l) => l.itemId))
        for (const r of existing) if (!kept.has(r.id)) updateRow('sale_items', r.id, { deleted_at: nowIso() })
        for (const l of lines) {
          if (!l.itemId) {
            insertRow('sale_items', {
              sale_id: id, product_id: l.productId, qty_pieces: l.qty, unit_sell_price: l.price, unit_buy_price: l.buy,
            })
          } else if (keep[l.itemId].qty_pieces !== l.qty || keep[l.itemId].unit_sell_price !== l.price) {
            updateRow('sale_items', l.itemId, { qty_pieces: l.qty, unit_sell_price: l.price })
          }
        }
      })
      return done(id)
    },

    // What deleting this sale would change, so the app can warn first.
    deleteSaleImpact(id) {
      const s = driver.get(
        `select ss.shop_id, ss.sale_date, ss.due from sales_summary ss where ss.id = ?`, [id])
      if (!s) return null
      const paidLater = settleShopDues(s.shop_id)[id]?.paidLater ?? 0
      const balance = driver.get('select balance from shop_balances where shop_id = ?', [s.shop_id])?.balance ?? 0
      const after = balance - Math.max(s.due, 0)
      return {
        isOld: s.sale_date < todayDhaka(),
        saleDate: s.sale_date,
        paidLater: toNumber(paidLater),
        creditAfter: after < 0 ? toNumber(-after) : 0,
      }
    },

    // Marks the sale and its lines deleted (never removed): totals, stock and dues adjust by themselves.
    async deleteSale(id) {
      if (!driver.get('select 1 as x from sales where id = ? and deleted_at is null', [id])) throw fail('Sale not found')
      const lines = driver.all('select id from sale_items where sale_id = ? and deleted_at is null', [id])
      driver.transaction(() => {
        const now = nowIso()
        updateRow('sales', id, { deleted_at: now })
        for (const l of lines) updateRow('sale_items', l.id, { deleted_at: now })
      })
      return done()
    },

    // paid_later / still_due: what the shop paid afterwards (Dues > Collect) against this sale.
    // Payments belong to the shop, not to one sale, so they are applied to its oldest dues first.
    salesSummaryByDate(date) {
      const rows = driver.all(
        `select ss.id, ss.shop_id, ss.paid_amount, ss.cost, ss.total, ss.due, ss.profit
         from sales_summary ss join sales s on s.id = ss.id
         where ss.sale_date = ? order by s.created_at, s.rowid`,
        [date]
      )
      const settled = {}
      for (const shopId of new Set(rows.map((r) => r.shop_id))) Object.assign(settled, settleShopDues(shopId))
      for (const r of rows) {
        const s = settled[r.id] || { paidLater: 0, stillDue: Math.max(r.due, 0) }
        r.paid_later = s.paidLater
        r.still_due = s.stillDue
      }
      return money(rows, ['paid_amount', 'cost', 'total', 'due', 'profit', 'paid_later', 'still_due'])
    },

    // every line of every sale on a date, grouped by sale id: { [saleId]: [line, ...] }
    saleItemsByDate(date) {
      const rows = driver.all(
        `select i.id, i.sale_id, i.product_id, coalesce(p.name, '(unknown product)') as name, p.pieces_per_carton,
                i.qty_pieces, i.unit_sell_price, i.unit_buy_price
         from sale_items i
         join sales s on s.id = i.sale_id
         left join products p on p.id = i.product_id
         where s.sale_date = ? and s.deleted_at is null and s.cancelled_at is null and i.deleted_at is null
         order by s.created_at, s.rowid, i.rowid`,
        [date]
      )
      const bySale = {}
      for (const r of rows) {
        ;(bySale[r.sale_id] ??= []).push({
          id: r.id,
          product_id: r.product_id,
          name: r.name,
          pieces_per_carton: r.pieces_per_carton,
          qty_pieces: r.qty_pieces,
          unit_sell_price: toNumber(r.unit_sell_price),
          unit_buy_price: toNumber(r.unit_buy_price),
          cost: toNumber(r.qty_pieces * r.unit_buy_price),
          sold_for: r.unit_sell_price === null ? null : toNumber(r.qty_pieces * r.unit_sell_price),
        })
      }
      return bySale
    },

    // cash that came in on a date apart from the sales themselves
    dayCash(date) {
      const dues = driver.get(
        'select coalesce(sum(amount), 0) as v from payments where pay_date = ? and deleted_at is null', [date])
      const driverPaid = driver.get(
        'select coalesce(sum(driver_paid), 0) as v from receipts where receive_date = ? and deleted_at is null', [date])
      return { duesIn: toNumber(dues.v), driverIn: toNumber(driverPaid.v) }
    },

    // ---------- dues ----------
    // shops that owe money, biggest first
    // unpaid_sales: the sales still (partly) unpaid, oldest first, each with what is left on it;
    // oldest_due_date: when the oldest of them was sold (how long the shop has owed you)
    duesList() {
      const rows = driver.all(
        `select sh.id, sh.name, sh.area, sh.phone, b.balance
         from shops sh join shop_balances b on b.shop_id = sh.id
         where sh.deleted_at is null and b.balance > 0 order by b.balance desc, lower(sh.name)`
      )
      return money(rows, ['balance']).map((r) => {
        const unpaid = Object.entries(settleShopDues(r.id))
          .filter(([, d]) => d.stillDue > 0)
          .map(([id, d]) => ({ id, sale_date: d.saleDate, still_due: toNumber(d.stillDue), due: toNumber(d.stillDue + d.paidLater) }))
        return { ...r, unpaid_sales: unpaid, oldest_due_date: unpaid[0]?.sale_date ?? null }
      })
    },

    // shops that paid more than they owe (e.g. a sale they paid for was deleted)
    creditList() {
      const rows = driver.all(
        `select sh.id, sh.name, sh.area, sh.phone, -b.balance as credit
         from shops sh join shop_balances b on b.shop_id = sh.id
         where sh.deleted_at is null and b.balance < 0 order by b.balance, lower(sh.name)`
      )
      return money(rows, ['credit'])
    },

    totalOwed() {
      const r = driver.get('select coalesce(sum(case when balance > 0 then balance else 0 end), 0) as v from shop_balances')
      return toNumber(r.v)
    },

    async createPayment({ shopId, amount, payDate }) {
      const a = round2(toUnits(amount))
      if (a === null || a <= 0) throw fail('Enter an amount above 0')
      if (!driver.get('select 1 as x from shops where id = ? and deleted_at is null', [shopId])) {
        throw fail('Shop not found')
      }
      const id = driver.transaction(() =>
        insertRow('payments', { shop_id: shopId, amount: a, pay_date: payDate || todayDhaka() }))
      return done(id)
    },

    // ---------- company ----------
    companyBalance() {
      const r = driver.get('select paid, charged, balance from company_balance')
      return { paid: toNumber(r.paid), charged: toNumber(r.charged), balance: toNumber(r.balance) }
    },

    listCompanyPayments(limit = 20) {
      const rows = driver.all(
        `select id, pay_date, amount, note from company_payments where deleted_at is null
         order by pay_date desc, created_at desc, rowid desc limit ?`, [limit])
      return money(rows, ['amount'])
    },

    async createCompanyPayment({ amount, note, payDate }) {
      const a = round2(toUnits(amount))
      if (a === null || a <= 0) throw fail('Enter an amount above 0')
      const id = driver.transaction(() =>
        insertRow('company_payments', { amount: a, note: (note || '').trim() || null, pay_date: payDate || todayDhaka() }))
      return done(id)
    },

    // ---------- stock ----------
    productStock() {
      return driver.all('select product_id, received_pieces, sold_pieces from product_stock')
    },

    // items: [{ productId, memoQtyPieces, receivedQtyPieces }]
    async createReceipt({ receiveDate, memoNo, memoAmount, driverName, driverPaid, note, items }) {
      if (!Array.isArray(items) || items.length === 0) throw fail('Add at least one product')
      const lines = items.map((it) => {
        const memo = Number(it.memoQtyPieces)
        const recv = Number(it.receivedQtyPieces)
        if (!it.productId || !Number.isInteger(memo) || !Number.isInteger(recv) || memo < 0 || recv < 0 ||
            (memo === 0 && recv === 0)) {
          throw fail('Every line needs a product and a quantity')
        }
        const p = driver.get('select unit_buy_price from products where id = ? and deleted_at is null', [it.productId])
        if (!p) throw fail('Unknown product in lines')
        return { productId: it.productId, memo, recv, buy: p.unit_buy_price }
      })
      const memoAmt = round2(toUnits(memoAmount) ?? 0)
      const driverAmt = round2(toUnits(driverPaid) ?? 0)
      if (memoAmt < 0 || driverAmt < 0) throw fail('Amounts cannot be negative')

      const id = driver.transaction(() => {
        const rid = insertRow('receipts', {
          receive_date: receiveDate || todayDhaka(),
          memo_no: (memoNo || '').trim() || null,
          memo_amount: memoAmt,
          driver_name: (driverName || '').trim() || null,
          driver_paid: driverAmt,
          note: (note || '').trim() || null,
        })
        for (const l of lines) {
          insertRow('receipt_items', {
            receipt_id: rid, product_id: l.productId, memo_qty_pieces: l.memo,
            received_qty_pieces: l.recv, unit_buy_price: l.buy,
          })
        }
        return rid
      })
      return done(id)
    },

    recentReceipts(limit = 10) {
      const rows = driver.all(
        `select rs.id, rs.receive_date, rs.memo_no, rs.memo_amount, rs.driver_name, rs.driver_paid,
                rs.short_pieces, rs.short_value
         from receipts_summary rs join receipts r on r.id = rs.id
         order by rs.receive_date desc, r.created_at desc, r.rowid desc limit ?`, [limit])
      return money(rows, ['memo_amount', 'driver_paid', 'short_value'])
    },
  }
}
