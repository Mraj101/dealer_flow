import initSqlJs from 'sql.js'
import { makeDriver, migrate } from '../src/local/driver.js'
import { createRepo } from '../src/local/repo.js'

export const USER = '11111111-1111-1111-1111-111111111111'
let SQL
export async function openTestDb(userId = USER) {
  SQL ??= await initSqlJs()
  const db = new SQL.Database()
  migrate(db)
  const driver = makeDriver(db)
  if (userId) driver.setMeta('user_id', userId)
  return { db, driver, repo: createRepo(driver) }
}

// Same scenario as the Postgres seed used to test migration 08.
export async function seedScenario(repo) {
  const malai = await repo.saveProduct({ name: 'malai fun', pieces_per_carton: 48, unit_buy_price: '7.5416', unit_mrp: 10 })
  const choco = await repo.saveProduct({ name: 'choco fun', pieces_per_carton: 48, unit_buy_price: '7.54', unit_mrp: 10 })
  const cola = await repo.saveProduct({ name: 'cola', pieces_per_carton: 24, unit_buy_price: 18, unit_mrp: 25 })
  const alauddin = await repo.addShop({ name: 'Alauddin', area: 'nobigonj', phone: '017' })
  const tista = await repo.addShop({ name: 'Tista', area: 'bandar' })
  await repo.createSale({ shopId: alauddin, saleDate: '2026-10-19', billAmount: 400, paidAmount: 200,
    items: [{ productId: malai, qtyPieces: 48, unitSellPrice: 9 }, { productId: cola, qtyPieces: 24, unitSellPrice: 20 }] })
  await repo.createSale({ shopId: tista, saleDate: '2026-10-20', billAmount: 500, paidAmount: 500,
    items: [{ productId: choco, qtyPieces: 60, unitSellPrice: null }] })
  await repo.createPayment({ shopId: alauddin, amount: 100, payDate: '2026-10-21' })
  await repo.createCompanyPayment({ amount: 10000, note: 'bank', payDate: '2026-10-20' })
  await repo.createReceipt({ receiveDate: '2026-10-20', memoNo: 'M-1', memoAmount: 5000, driverName: 'Karim', driverPaid: 20,
    items: [{ productId: cola, memoQtyPieces: 240, receivedQtyPieces: 238 }, { productId: malai, memoQtyPieces: 480, receivedQtyPieces: 480 }] })
  return { malai, choco, cola, alauddin, tista }
}
