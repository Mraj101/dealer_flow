import test from 'node:test'
import assert from 'node:assert/strict'
import { openTestDb, seedScenario } from './helpers.js'

// Expected numbers are what the real Postgres views returned for this exact scenario
// (supabase 01-08 run on a local Postgres).
test('views match Postgres for the same scenario', async () => {
  const { repo, driver } = await openTestDb()
  const ids = await seedScenario(repo)

  const counts = ['products', 'shops', 'sales', 'sale_items', 'payments', 'company_payments', 'receipts', 'receipt_items']
    .map((t) => driver.get(`select count(*) c from ${t}`).c)
  assert.deepEqual(counts, [3, 2, 2, 3, 1, 1, 1, 2])

  const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + (r[k] ?? 0), 0) * 100) / 100
  const all = [...repo.salesSummaryByDate('2026-10-19'), ...repo.salesSummaryByDate('2026-10-20')]
  assert.equal(sum(all, 'paid_amount'), 700)
  assert.equal(sum(all, 'cost'), 1246.4)
  assert.equal(sum(all, 'total'), 900)
  assert.equal(sum(all, 'due'), 200)
  assert.equal(sum(all, 'profit'), -346.4)

  assert.deepEqual(repo.companyBalance(), { paid: 10000, charged: 5000, balance: 5000 })

  const owing = repo.duesList()
  assert.equal(owing.length, 1)
  assert.equal(owing[0].name, 'Alauddin')
  assert.equal(owing[0].balance, 100)
  assert.equal(repo.totalOwed(), 100)

  const stock = Object.fromEntries(repo.productStock().map((s) => [s.product_id, s]))
  assert.deepEqual([stock[ids.choco].received_pieces, stock[ids.choco].sold_pieces], [0, 60])
  assert.deepEqual([stock[ids.cola].received_pieces, stock[ids.cola].sold_pieces], [238, 24])
  assert.deepEqual([stock[ids.malai].received_pieces, stock[ids.malai].sold_pieces], [480, 48])

  const [receipt] = repo.recentReceipts()
  assert.equal(receipt.memo_no, 'M-1')
  assert.equal(receipt.memo_amount, 5000)
  assert.equal(receipt.short_pieces, 2)
  assert.equal(receipt.short_value, 36)

  const prices = Object.fromEntries(repo.listProducts().map((p) => [p.name, p.unit_buy_price]))
  assert.deepEqual(prices, { 'choco fun': 7.54, cola: 18, 'malai fun': 7.5416 })

  assert.deepEqual(repo.dayCash('2026-10-21'), { duesIn: 100, driverIn: 0 })
  assert.deepEqual(repo.dayCash('2026-10-20'), { duesIn: 0, driverIn: 20 })
})

test('sale rules match the Postgres function', async () => {
  const { repo } = await openTestDb()
  const p = await repo.saveProduct({ name: 'x', pieces_per_carton: 10, unit_buy_price: 5 })
  const s = await repo.addShop({ name: 'S' })
  const base = { shopId: s, saleDate: '2026-10-19', items: [{ productId: p, qtyPieces: 2, unitSellPrice: null }] }
  await assert.rejects(repo.createSale({ ...base, shopId: 'nope', billAmount: 10 }), /Shop not found/)
  await assert.rejects(repo.createSale({ ...base, items: [], billAmount: 10 }), /at least one line/)
  await assert.rejects(repo.createSale({ ...base, items: [{ productId: 'nope', qtyPieces: 1 }], billAmount: 10 }), /Unknown product/)
  await assert.rejects(repo.createSale({ ...base, items: [{ productId: p, qtyPieces: 0 }], billAmount: 10 }), /quantity above 0/)
  await assert.rejects(repo.createSale({ ...base, billAmount: null }), /bill amount/)
  await assert.rejects(repo.createSale({ ...base, billAmount: 10, paidAmount: 11 }), /between 0 and the bill/)
  await assert.rejects(repo.createSale({ ...base, billAmount: 10, paidAmount: -1 }), /between 0 and the bill/)
  // bill from line prices, paid in full by default
  const id = await repo.createSale({ ...base, billAmount: null, items: [{ productId: p, qtyPieces: 2, unitSellPrice: 7.5 }] })
  const [row] = repo.salesSummaryByDate('2026-10-19')
  assert.equal(row.id, id)
  assert.equal(row.total, 15)
  assert.equal(row.paid_amount, 15)
  assert.equal(row.due, 0)
  assert.equal(row.profit, 5)
})

test('a failed sale leaves nothing behind', async () => {
  const { repo, driver } = await openTestDb()
  const p = await repo.saveProduct({ name: 'x', pieces_per_carton: 10, unit_buy_price: 5 })
  const s = await repo.addShop({ name: 'S' })
  await assert.rejects(repo.createSale({ shopId: s, billAmount: 10, paidAmount: 99,
    items: [{ productId: p, qtyPieces: 1 }] }))
  assert.equal(driver.get('select count(*) c from sales').c, 0)
  assert.equal(driver.get('select count(*) c from sale_items').c, 0)
})

test('shops: duplicate name+area rejected, same name in another area allowed', async () => {
  const { repo } = await openTestDb()
  await repo.addShop({ name: 'Rahim', area: 'A' })
  await assert.rejects(repo.addShop({ name: ' rahim ', area: 'a' }), (e) => e.code === '23505')
  await repo.addShop({ name: 'Rahim', area: 'B' })
  await assert.rejects(repo.addShop({ name: '' }), /shop name/)
})

test('products: validation, edit, soft delete', async () => {
  const { repo } = await openTestDb()
  await assert.rejects(repo.saveProduct({ name: '', pieces_per_carton: 1, unit_buy_price: 1 }), /product name/)
  await assert.rejects(repo.saveProduct({ name: 'a', pieces_per_carton: 0, unit_buy_price: 1 }), /per carton/)
  await assert.rejects(repo.saveProduct({ name: 'a', pieces_per_carton: 1, unit_buy_price: '' }), /buy price/)
  const id = await repo.saveProduct({ name: 'a', pieces_per_carton: 12, unit_buy_price: 1.5 })
  await repo.saveProduct({ id, name: 'a2', pieces_per_carton: 12, unit_buy_price: 2, unit_mrp: 3 })
  assert.deepEqual(repo.listProducts().map((p) => [p.name, p.unit_buy_price, p.unit_mrp]), [['a2', 2, 3]])
  await repo.deleteProduct(id)
  assert.equal(repo.listProducts().length, 0)
})

test('a sale keeps its buy price when the product price changes later', async () => {
  const { repo } = await openTestDb()
  const p = await repo.saveProduct({ name: 'x', pieces_per_carton: 10, unit_buy_price: 5 })
  const s = await repo.addShop({ name: 'S' })
  await repo.createSale({ shopId: s, saleDate: '2026-10-19', billAmount: 30, items: [{ productId: p, qtyPieces: 2, unitSellPrice: null }] })
  await repo.saveProduct({ id: p, name: 'x', pieces_per_carton: 10, unit_buy_price: 9 })
  assert.equal(repo.salesSummaryByDate('2026-10-19')[0].cost, 10)
})

test('payments and receipts validate', async () => {
  const { repo } = await openTestDb()
  const s = await repo.addShop({ name: 'S' })
  const p = await repo.saveProduct({ name: 'x', pieces_per_carton: 10, unit_buy_price: 5 })
  await assert.rejects(repo.createPayment({ shopId: s, amount: 0 }), /above 0/)
  await assert.rejects(repo.createPayment({ shopId: 'nope', amount: 5 }), /Shop not found/)
  await assert.rejects(repo.createCompanyPayment({ amount: -1 }), /above 0/)
  await assert.rejects(repo.createReceipt({ items: [] }), /at least one/)
  await assert.rejects(repo.createReceipt({ items: [{ productId: p, memoQtyPieces: 0, receivedQtyPieces: 0 }] }), /quantity/)
  await assert.rejects(repo.createReceipt({ memoAmount: -5, items: [{ productId: p, memoQtyPieces: 1, receivedQtyPieces: 1 }] }), /negative/)
})

test('writing requires a signed-in user', async () => {
  const { repo } = await openTestDb(null)
  await assert.rejects(repo.addShop({ name: 'S' }), /Not signed in/)
})

test('saleItemsByDate lists each sale\'s lines with cost and sell value', async () => {
  const { repo } = await openTestDb()
  const ids = await seedScenario(repo)
  const [sale1] = repo.salesSummaryByDate('2026-10-19')
  const lines = repo.saleItemsByDate('2026-10-19')[sale1.id]
  assert.deepEqual(lines.map((l) => [l.name, l.qty_pieces, l.unit_sell_price, l.cost, l.sold_for]), [
    ['malai fun', 48, 9, 361.9968, 432],
    ['cola', 24, 20, 432, 480],
  ])
  // a line typed without a price: cost is known, sell value is not
  const [sale2] = repo.salesSummaryByDate('2026-10-20')
  const [line] = repo.saleItemsByDate('2026-10-20')[sale2.id]
  assert.deepEqual([line.name, line.qty_pieces, line.sold_for], ['choco fun', 60, null])
  // a product deleted later still shows its name on old sales
  await repo.deleteProduct(ids.cola)
  assert.ok(repo.saleItemsByDate('2026-10-19')[sale1.id].some((l) => l.name === 'cola'))
  assert.deepEqual(repo.saleItemsByDate('2026-01-01'), {})
})

test('payments collected later settle a shop\'s oldest dues first', async () => {
  const { repo } = await openTestDb()
  const p = await repo.saveProduct({ name: 'x', pieces_per_carton: 10, unit_buy_price: 5 })
  const s = await repo.addShop({ name: 'S' })
  const other = await repo.addShop({ name: 'Other' })
  const item = [{ productId: p, qtyPieces: 10, unitSellPrice: null }]
  await repo.createSale({ shopId: s, saleDate: '2026-11-01', billAmount: 300, paidAmount: 100, items: item }) // due 200
  await repo.createSale({ shopId: s, saleDate: '2026-11-02', billAmount: 150, paidAmount: 0, items: item })   // due 150
  await repo.createSale({ shopId: s, saleDate: '2026-11-02', billAmount: 80, paidAmount: 80, items: item })   // no due
  await repo.createSale({ shopId: other, saleDate: '2026-11-02', billAmount: 90, paidAmount: 0, items: item }) // other shop

  const status = () => ['2026-11-01', '2026-11-02'].flatMap((d) => repo.salesSummaryByDate(d))
    .map((r) => [r.due, r.paid_later, r.still_due])
  // nothing collected yet
  assert.deepEqual(status(), [[200, 0, 200], [150, 0, 150], [0, 0, 0], [90, 0, 90]])

  // collect 250 from S: the oldest (200) is cleared, 50 goes to the next one
  await repo.createPayment({ shopId: s, amount: 250, payDate: '2026-11-03' })
  assert.deepEqual(status(), [[200, 200, 0], [150, 50, 100], [0, 0, 0], [90, 0, 90]])

  // collect the rest: every due from S is paid; the other shop is untouched
  await repo.createPayment({ shopId: s, amount: 100, payDate: '2026-11-04' })
  assert.deepEqual(status(), [[200, 200, 0], [150, 150, 0], [0, 0, 0], [90, 0, 90]])

  // what is still unpaid matches the Dues tab
  assert.equal(repo.totalOwed(), 90)
})

// ---------- editing and deleting sales ----------
async function editSetup() {
  const { repo, driver } = await openTestDb()
  const cola = await repo.saveProduct({ name: 'cola', pieces_per_carton: 24, unit_buy_price: 18 })
  const chips = await repo.saveProduct({ name: 'chips', pieces_per_carton: 10, unit_buy_price: 5 })
  const tea = await repo.saveProduct({ name: 'tea', pieces_per_carton: 12, unit_buy_price: 30 })
  const shop = await repo.addShop({ name: 'S' })
  const other = await repo.addShop({ name: 'Other' })
  const saleId = await repo.createSale({ shopId: shop, saleDate: '2026-11-01', billAmount: 700, paidAmount: 300,
    items: [{ productId: cola, qtyPieces: 24 }, { productId: chips, qtyPieces: 20 }] }) // cost 432 + 100
  const stock = () => Object.fromEntries(repo.productStock().map((s) => [s.product_id, s.sold_pieces]))
  return { repo, driver, cola, chips, tea, shop, other, saleId, stock }
}

test('getSale returns the sale with its lines and products', async () => {
  const { repo, saleId, cola, chips } = await editSetup()
  const s = repo.getSale(saleId)
  assert.equal(s.bill_amount, 700)
  assert.equal(s.paid_amount, 300)
  assert.deepEqual(s.items.map((i) => [i.product_id, i.qty_pieces, i.unit_buy_price, i.product.name]),
    [[cola, 24, 18, 'cola'], [chips, 20, 5, 'chips']])
  assert.equal(repo.getSale('nope'), null)
})

test('updateSale: change qty, remove a line, add a line; untouched lines keep their old buy price', async () => {
  const { repo, driver, saleId, cola, chips, tea, stock } = await editSetup()
  await repo.saveProduct({ id: cola, name: 'cola', pieces_per_carton: 24, unit_buy_price: 25 }) // price went up later
  const [colaLine] = repo.getSale(saleId).items
  await repo.updateSale(saleId, {
    shopId: repo.getSale(saleId).shop_id, saleDate: '2026-11-01', billAmount: 900, paidAmount: 500,
    items: [
      { itemId: colaLine.id, productId: cola, qtyPieces: 48 }, // more cola, original price 18
      { productId: tea, qtyPieces: 12 },                       // new line at today's price 30
    ],                                                         // chips line removed
  })
  const s = repo.getSale(saleId)
  assert.deepEqual(s.items.map((i) => [i.product.name, i.qty_pieces, i.unit_buy_price]), [['cola', 48, 18], ['tea', 12, 30]])
  const [row] = repo.salesSummaryByDate('2026-11-01')
  assert.deepEqual([row.total, row.paid_amount, row.due, row.cost, row.profit], [900, 500, 400, 1224, -324])
  assert.deepEqual(stock(), { [cola]: 48, [chips]: 0, [tea]: 12 })
  // the removed line is kept, marked deleted, and waiting to sync
  assert.equal(driver.get('select count(*) c from sale_items where sale_id = ? and deleted_at is not null', [saleId]).c, 1)
  assert.equal(driver.get('select _dirty from sales where id = ?', [saleId])._dirty, 1)
})

test('updateSale: a line whose product is changed becomes a new line at today\'s price', async () => {
  const { repo, saleId, cola, tea } = await editSetup()
  const s = repo.getSale(saleId)
  await repo.updateSale(saleId, { shopId: s.shop_id, saleDate: s.sale_date, billAmount: 700, paidAmount: 300,
    items: [{ itemId: s.items[0].id, productId: tea, qtyPieces: 12 }, { itemId: s.items[1].id, productId: s.items[1].product_id, qtyPieces: 20 }] })
  const after = repo.getSale(saleId)
  assert.deepEqual(after.items.map((i) => [i.product.name, i.unit_buy_price]), [['chips', 5], ['tea', 30]])
  assert.ok(!after.items.some((i) => i.product_id === cola))
})

test('updateSale: same rules as a new sale, and a failed edit changes nothing', async () => {
  const { repo, saleId, cola } = await editSetup()
  const s = repo.getSale(saleId)
  const base = { shopId: s.shop_id, saleDate: s.sale_date, items: [{ itemId: s.items[0].id, productId: cola, qtyPieces: 24 }] }
  await assert.rejects(repo.updateSale(saleId, { ...base, billAmount: 100, paidAmount: 200 }), /between 0 and the bill/)
  await assert.rejects(repo.updateSale(saleId, { ...base, billAmount: 100, items: [] }), /at least one line/)
  await assert.rejects(repo.updateSale(saleId, { ...base, shopId: 'nope', billAmount: 100 }), /Shop not found/)
  await assert.rejects(repo.updateSale('nope', { ...base, billAmount: 100 }), /Sale not found/)
  assert.deepEqual(repo.getSale(saleId), s)
})

test('updateSale: a line for a product deleted since the sale can still be kept', async () => {
  const { repo, saleId, chips } = await editSetup()
  await repo.deleteProduct(chips)
  const s = repo.getSale(saleId)
  await repo.updateSale(saleId, { shopId: s.shop_id, saleDate: s.sale_date, billAmount: 650, paidAmount: 300,
    items: s.items.map((i) => ({ itemId: i.id, productId: i.product_id, qtyPieces: i.qty_pieces })) })
  assert.equal(repo.getSale(saleId).bill_amount, 650)
  assert.equal(repo.getSale(saleId).items.length, 2)
})

test('updateSale: moving a sale to another shop and date moves its due', async () => {
  const { repo, saleId, other } = await editSetup()
  const s = repo.getSale(saleId)
  await repo.updateSale(saleId, { shopId: other, saleDate: '2026-11-02', billAmount: 700, paidAmount: 300,
    items: s.items.map((i) => ({ itemId: i.id, productId: i.product_id, qtyPieces: i.qty_pieces })) })
  assert.equal(repo.salesSummaryByDate('2026-11-01').length, 0)
  assert.equal(repo.salesSummaryByDate('2026-11-02')[0].shop_id, other)
  assert.deepEqual(repo.duesList().map((d) => [d.name, d.balance]), [['Other', 400]])
})

test('deleteSale: the day, stock and dues all adjust; rows are kept, marked deleted', async () => {
  const { repo, driver, saleId, cola, chips, tea, stock } = await editSetup()
  assert.equal(repo.totalOwed(), 400)
  await repo.deleteSale(saleId)
  assert.equal(repo.salesSummaryByDate('2026-11-01').length, 0)
  assert.deepEqual(repo.saleItemsByDate('2026-11-01'), {})
  assert.deepEqual(stock(), { [cola]: 0, [chips]: 0, [tea]: 0 })
  assert.equal(repo.totalOwed(), 0)
  assert.equal(repo.getSale(saleId), null)
  assert.equal(driver.get('select count(*) c from sales where deleted_at is not null').c, 1)
  assert.equal(driver.get('select count(*) c from sale_items where deleted_at is not null').c, 2)
  await assert.rejects(repo.deleteSale(saleId), /Sale not found/)
})

test('deleteSaleImpact warns about old dates and dues already paid (shop ends in credit)', async () => {
  const { repo, saleId, shop } = await editSetup()
  let impact = repo.deleteSaleImpact(saleId)
  assert.deepEqual([impact.isOld, impact.paidLater, impact.creditAfter], [true, 0, 0]) // 2026-11-01 is in the past

  await repo.createPayment({ shopId: shop, amount: 400, payDate: '2026-11-02' }) // the 400 due was paid later
  impact = repo.deleteSaleImpact(saleId)
  assert.deepEqual([impact.paidLater, impact.creditAfter], [400, 400])

  await repo.deleteSale(saleId)
  assert.deepEqual(repo.creditList().map((c) => [c.name, c.credit]), [['S', 400]])
  assert.equal(repo.totalOwed(), 0)
  assert.deepEqual(repo.duesList(), [])
})
