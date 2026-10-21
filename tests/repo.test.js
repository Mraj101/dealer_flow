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
