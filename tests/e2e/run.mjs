// End-to-end: the built app in real Chrome, against an in-memory fake Supabase.
//   node tests/e2e/run.mjs
// Checks: first sync, working offline, surviving a reload offline, syncing on reconnect,
// and a second phone getting the same data.
import { chromium } from 'playwright-core'
import { spawn, execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { createFakeServer, FAKE_URL, FAKE_USER } from './fake-supabase.js'

const root = path.resolve(import.meta.dirname, '../..')
const dist = process.env.E2E_DIST || path.join(os.tmpdir(), 'dealer-e2e-dist')
const port = 4179

// build with the fake URL (shell env beats .env, so the real keys are never used)
execFileSync(path.join(root, 'node_modules/.bin/vite'), ['build', '--outDir', dist, '--emptyOutDir'], {
  cwd: root, stdio: 'ignore',
  env: { ...process.env, VITE_SUPABASE_URL: FAKE_URL, VITE_SUPABASE_ANON_KEY: 'fake-anon-key' },
})
const preview = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 2500))

const server = createFakeServer()
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const pageErrors = []

async function newPhone() {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } })
  await context.route(`${FAKE_URL}/**`, (route) => server.handle(route))
  const page = await context.newPage()
  page.on('pageerror', (e) => pageErrors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) pageErrors.push(m.text()) })
  return { context, page }
}
// Home, Day, Sale, Dues and More are in the bottom bar; everything else is a tile on the More page
const BAR = ['Home', 'Day', 'Sale', 'Dues', 'More']
const tab = async (page, name) => {
  if (BAR.includes(name)) return page.locator('nav button', { hasText: new RegExp(`^${name}$`) }).click()
  await page.locator('nav button', { hasText: /^More$/ }).click()
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
}
const syncText = (page) => page.locator('div.mb-4.rounded-lg').first().innerText()
const waitSync = (page, re) => page.waitForFunction((src) =>
  new RegExp(src).test(document.querySelector('div.mb-4.rounded-lg')?.innerText || ''), re.source, { timeout: 15000 })
let step = 0
const ok = (msg) => console.log(`✔ ${++step}. ${msg}`)

try {
  // ---------- phone A: sign in, first sync ----------
  const A = await newPhone()
  const a = A.page
  await a.goto(`http://localhost:${port}/`)
  await a.getByPlaceholder('Email').fill('a@b.c')
  await a.getByPlaceholder('Password').fill('pw')
  await a.getByRole('button', { name: 'Sign in' }).click()
  await waitSync(a, /All synced/)
  ok('sign in and first sync (no data yet) -> "All synced"')

  // ---------- add data online ----------
  await tab(a, 'Products')
  for (const [name, per, buy, mrp] of [['cola', '24', '18', '25'], ['malai fun', '48', '7.5416', '10']]) {
    await a.getByPlaceholder('Product name').fill(name)
    await a.getByPlaceholder('Pieces per carton').fill(per)
    await a.getByPlaceholder('Buy price (1 piece)').fill(buy)
    await a.getByPlaceholder('MRP (optional)').fill(mrp)
    await a.getByRole('button', { name: 'Save product' }).click()
    await a.getByText('Product added').waitFor()
  }
  await tab(a, 'Shops')
  await a.getByPlaceholder('Shop name').fill('Alauddin')
  await a.getByPlaceholder('Area (optional)').fill('nobigonj')
  await a.getByRole('button', { name: 'Save shop' }).click()
  await a.getByText('Shop added').waitFor()
  await waitSync(a, /All synced/)
  assert.equal(server.tables.products.size, 2)
  assert.equal(server.tables.shops.size, 1)
  const malai = [...server.tables.products.values()].find((p) => p.name === 'malai fun')
  assert.equal(malai.unit_buy_price, '7.5416')
  assert.equal(malai.user_id, FAKE_USER)
  ok('products and shop saved on the phone and reached the server (buy price kept at 4 decimals)')

  // ---------- go offline, record a sale ----------
  server.state.offline = true
  await tab(a, 'Sale')
  await a.getByPlaceholder('Search shop').click()
  await a.getByText('Alauddin (nobigonj)').click()
  await a.getByPlaceholder('Search product').click()
  await a.locator('li', { hasText: 'cola' }).first().click()
  await a.getByPlaceholder('Cartons').fill('1')
  await a.locator('input[inputmode="decimal"]').nth(1).fill('600') // bill amount
  await a.locator('input[inputmode="decimal"]').nth(2).fill('400') // money collected
  await a.getByRole('button', { name: 'Save sale' }).click()
  await a.getByText('Saved. Due: 200.00').waitFor()
  await waitSync(a, /Offline · 1 waiting/)
  ok('offline: sale saved on the phone, bar says "Offline · 1 waiting to sync"')

  // ---------- reload while still offline ----------
  await a.reload()
  await a.getByRole('button', { name: 'Sale', exact: true }).waitFor({ timeout: 15000 })
  await waitSync(a, /Offline · 1 waiting/)
  await tab(a, 'Day')
  await a.getByRole('button', { name: /Alauddin/ }).waitFor()
  assert.match(await a.locator('body').innerText(), /Still unpaid\s*›?\s*200\.00/)
  // tap "Still unpaid": only this day's dues, then straight to collecting from that shop
  await a.getByRole('button', { name: /Still unpaid/ }).click()
  await a.getByRole('heading', { name: 'Dues from this day' }).waitFor()
  const dd = await a.locator('main').innerText()
  assert.match(dd, /Due from 1 sale this day\s*200\.00/)
  assert.match(dd, /Alauddin[\s\S]*Unpaid[\s\S]*cola 1 ctn/)
  assert.match(dd, /Bill\s*600\.00\s*Collected at the sale\s*400\.00\s*Due from this sale\s*200\.00\s*Paid later\s*0\.00\s*Still due\s*200\.00/)
  assert.match(dd, /No payment received from this shop since/)
  await a.getByRole('button', { name: 'Collect from Alauddin' }).click()
  await a.getByPlaceholder('Amount received').waitFor()                 // Dues opens with Alauddin's form open
  await a.getByRole('button', { name: 'Back' }).click()
  await a.getByRole('button', { name: 'Back' }).click()
  await a.getByRole('button', { name: /Still unpaid/ }).waitFor()      // back on the Day screen
  ok('offline reload: app opens with no internet and the sale is still there')

  await tab(a, 'Dues')
  await a.getByText('Alauddin').first().waitFor()
  assert.match(await a.locator('body').innerText(), /Total to collect\s*200\.00/)
  assert.match(await a.locator('body').innerText(), /Due since \d+ \w+ \d{4} · today/)
  await a.getByRole('button', { name: 'Collect' }).click()
  assert.match(await a.locator('body').innerText(), /Unpaid sales, oldest first[\s\S]*today\s*200\.00/)
  await a.getByRole('button', { name: 'Close' }).click()
  ok('offline: Dues shows Alauddin owing 200.00')

  // ---------- reconnect ----------
  server.state.offline = false
  await a.evaluate(() => window.dispatchEvent(new Event('online')))
  await waitSync(a, /All synced/)
  assert.equal(server.tables.sales.size, 1)
  assert.equal(server.tables.sale_items.size, 1)
  const sale = [...server.tables.sales.values()][0]
  assert.equal(sale.bill_amount, '600')
  assert.equal(sale.paid_amount, '400')
  assert.equal([...server.tables.sale_items.values()][0].unit_buy_price, '18')
  ok('reconnect: the sale synced by itself (bill 600, paid 400, buy price copied)')

  // the requests really are shaped the way PostgREST needs
  const posts = server.log.filter((l) => l.method === 'POST')
  assert.ok(posts.every((p) => p.url.includes('on_conflict=id') && /resolution=merge-duplicates/.test(p.prefer || '')))
  const pulls = server.log.filter((l) => l.method === 'GET' && decodeURIComponent(l.url).includes('updated_at.gt.'))
  assert.ok(pulls.length > 0, 'later pulls use the keyset cursor')
  ok('requests use upsert (on_conflict=id, merge-duplicates) and cursor pulls')

  // ---------- collect the due ----------
  await tab(a, 'Dues')
  await a.getByRole('button', { name: 'Collect' }).click()
  await a.getByPlaceholder('Amount received').fill('200')
  await a.getByRole('button', { name: 'Save payment' }).click()
  await a.getByText('No shop owes you anything').waitFor()
  await waitSync(a, /All synced/)
  assert.equal(server.tables.payments.size, 1)
  ok('collected the due; shop disappears from Dues; payment synced')

  // ---------- receive stock, check stock numbers ----------
  await tab(a, 'Receive goods')
  await a.getByPlaceholder('Search product').click()
  await a.locator('li', { hasText: 'cola' }).first().click()
  await a.getByPlaceholder('Cartons').first().fill('10')
  await a.getByPlaceholder('Cartons').nth(1).fill('9') // one carton short
  await a.getByRole('button', { name: 'Save delivery' }).click()
  await a.getByText('Delivery saved, stock updated').waitFor()
  await tab(a, 'In stock')
  assert.match(await a.locator('li', { hasText: 'cola' }).first().innerText(), /8 ctn/) // 9 cartons - 1 sold carton
  await waitSync(a, /All synced/)
  assert.equal(server.tables.receipt_items.size, 1)
  ok('delivery with a missing carton: stock = 9 received - 1 sold = 8 ctn')

  // ---------- phone B: brand new, same account ----------
  const B = await newPhone()
  const b = B.page
  await b.goto(`http://localhost:${port}/`)
  await b.getByPlaceholder('Email').fill('a@b.c')
  await b.getByPlaceholder('Password').fill('pw')
  await b.getByRole('button', { name: 'Sign in' }).click()
  await waitSync(b, /All synced/)
  await tab(b, 'In stock')
  assert.match(await b.locator('li', { hasText: 'cola' }).first().innerText(), /8 ctn/)
  await tab(b, 'Day')
  await b.locator('input[type="date"]').fill(sale.sale_date)
  await b.getByRole('button', { name: /Alauddin/ }).waitFor()
  ok('second phone: signs in, downloads everything, same sale and same stock')

  const card = b.locator('li', { hasText: 'Alauddin' })
  assert.match(await card.innerText(), /cola 1 ctn/)       // items preview on the closed card
  await b.getByRole('button', { name: /Alauddin/ }).click()
  await card.getByText('Due from this sale').waitFor() // the details slide open
  const details = await card.innerText()
  assert.match(details, /cola\s+24 pcs\/ctn · buy 18\/pc\s+1 ctn\s+432\.00/)     // 24 pcs x 18
  assert.match(details, /Bill\s*600\.00/)
  // the 200 due was collected later on phone A (Dues > Collect), so this old sale shows it as paid
  assert.match(details, /Paid later ✓/)
  assert.match(details, /Due from this sale\s*200\.00/)
  assert.match(details, /Paid later\s*200\.00/)
  assert.match(details, /Still due\s*0\.00/)
  assert.match(await b.locator('body').innerText(), /Still unpaid\s*›?\s*0\.00/)
  await b.getByRole('tab', { name: /Products/ }).click()
  assert.match(await b.locator('table').innerText(), /cola\s+24 pcs\/ctn · 18\/pc\s+1 shop\s+1 ctn\s+432\.00/)
  ok('Day screen: items (cola · 1 ctn, cost 432.00); a due collected later shows as paid, not still due')

  // ---------- expired login, no internet: the app still opens ----------
  server.state.offline = true
  await a.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('auth-token'))
    const s = JSON.parse(localStorage.getItem(k))
    s.expires_at = Math.floor(Date.now() / 1000) - 600
    localStorage.setItem(k, JSON.stringify(s))
  })
  await a.reload()
  await a.getByRole('button', { name: 'Sale', exact: true }).waitFor({ timeout: 15000 })
  await tab(a, 'Day')
  await a.getByRole('button', { name: /Alauddin/ }).waitFor()
  ok('login expired + no internet: the app still opens and shows your data')
  server.state.offline = false

  // ---------- a phone whose very first download fails, then works ----------
  const C = await newPhone()
  const c = C.page
  server.state.restDown = true
  await c.goto(`http://localhost:${port}/`)
  await c.getByPlaceholder('Email').fill('a@b.c')
  await c.getByPlaceholder('Password').fill('pw')
  await c.getByRole('button', { name: 'Sign in' }).click()
  await c.getByText(/needs internet to load your data/).waitFor({ timeout: 15000 })
  server.state.restDown = false
  await c.getByRole('button', { name: 'Try again' }).click()
  await waitSync(c, /All synced/)
  await tab(c, 'Products')
  await c.getByText('malai fun').waitFor()
  ok('first download fails -> clear message; "Try again" works once internet is back')

  // ---------- add a shop straight from the Sale screen's search ----------
  await tab(a, 'Sale')
  await a.getByPlaceholder('Search shop').click()
  await a.getByPlaceholder('Search shop').fill('Karim Store')
  await a.getByText('+ Add new shop “Karim Store”').click()
  assert.equal(await a.getByLabel('New shop name').inputValue(), 'Karim Store')
  await a.getByPlaceholder('Area (optional)').fill('Bandar')
  await a.getByRole('button', { name: 'Save shop' }).click()
  await a.waitForFunction(() => // saving is async: wait until the new shop is selected for this sale
    document.querySelector('input[placeholder="Search shop"]').value === 'Karim Store (Bandar)')
  await waitSync(a, /All synced/)
  assert.ok([...server.tables.shops.values()].some((sh) => sh.name === 'Karim Store' && sh.area === 'Bandar'))
  // typing an existing name offers no "add"; a duplicate name + area is refused
  await a.getByPlaceholder('Search shop').click()
  await a.getByPlaceholder('Search shop').fill('alauddin')
  assert.equal(await a.getByText(/\+ Add new shop/).count(), 1) // 'alauddin' alone is not an exact shop label
  await a.getByPlaceholder('Search shop').fill('Karim Store (Bandar)')
  assert.equal(await a.getByText(/\+ Add new shop/).count(), 0)
  await a.getByPlaceholder('Search shop').fill('karim store')
  await a.getByText(/\+ Add new shop/).click()
  await a.getByPlaceholder('Area (optional)').fill('bandar')
  await a.getByRole('button', { name: 'Save shop' }).click()
  await a.getByText('This shop already exists in this area').waitFor()
  await a.getByRole('button', { name: 'Cancel' }).click()
  ok('add a shop from the Sale search: name pre-filled, selected for the sale, synced; duplicates refused')

  // ---------- edit a sale, then delete it, with NO internet ----------
  server.state.offline = true
  await tab(a, 'Day')
  await a.locator('input[type="date"]').fill(sale.sale_date)
  await a.getByRole('button', { name: /Alauddin/ }).click()
  await a.getByRole('button', { name: 'Edit sale' }).click()
  await a.getByRole('heading', { name: 'Edit sale' }).waitFor()
  assert.equal(await a.locator('#bill').inputValue(), '600')
  assert.equal(await a.locator('#paid').inputValue(), '400')
  await a.locator('#bill').fill('650')
  await a.getByRole('button', { name: 'Save changes' }).click()
  await a.getByRole('button', { name: /Alauddin/ }).waitFor() // back on the Day screen
  assert.match(await a.locator('li', { hasText: 'Alauddin' }).innerText(), /650\.00/)
  await waitSync(a, /Offline · 1 waiting/)
  assert.equal([...server.tables.sales.values()][0].bill_amount, '600') // server not told yet
  ok('offline edit: opens filled in, saves on the phone (bill 600 -> 650), waits to sync')

  const dialogs = []
  a.once('dialog', (d) => { dialogs.push(d.message()); d.accept() })
  await a.getByRole('button', { name: /Alauddin/ }).click()
  await a.getByRole('button', { name: 'Delete sale' }).click()
  await a.getByText('No sales on this day').waitFor()
  assert.match(dialogs[0], /already paid 200\.00/)
  assert.match(dialogs[0], /200\.00 credit/)
  await waitSync(a, /Offline · 1 waiting/)
  assert.ok(![...server.tables.sales.values()][0].deleted_at) // server not told yet

  // back online: both changes go out
  server.state.offline = false
  await a.evaluate(() => window.dispatchEvent(new Event('online')))
  await waitSync(a, /All synced/)
  assert.equal(server.tables.sales.size, 1) // edited and deleted in place, never duplicated
  assert.equal([...server.tables.sales.values()][0].bill_amount, '650')
  const deleted = [...server.tables.sales.values()][0]
  assert.ok(deleted.deleted_at, 'sale is marked deleted on the server, not removed')
  assert.ok([...server.tables.sale_items.values()].every((i) => i.deleted_at))
  await tab(a, 'Dues')
  await a.getByText('Shops with credit').waitFor()
  assert.match(await a.locator('body').innerText(), /Credit 200\.00/)
  ok('offline delete: warns about the 200 paid later; on reconnect the edit + delete sync; shop shows 200 credit')

  // ---------- the DevTools helpers for looking inside the phone's database ----------
  const insp = await c.evaluate(() => {
    const names = window.dealerDb.tables().map((t) => t.name)
    const products = window.dealerDb.query('select name, unit_buy_price from products order by name')
    let refused = false
    try { window.dealerDb.query('delete from products') } catch { refused = true }
    return { names, products, refused, count: window.dealerDb.query('select count(*) n from products')[0].n }
  })
  assert.ok(['sales', 'sale_items', 'products', 'sales_summary', 'product_stock'].every((t) => insp.names.includes(t)))
  assert.deepEqual(insp.products, [{ name: 'cola', unit_buy_price: 180000 }, { name: 'malai fun', unit_buy_price: 75416 }])
  assert.equal(insp.refused, true)
  assert.equal(insp.count, 2)
  ok('dealerDb.tables() / dealerDb.query() work in the browser; writes through it are refused')

  // ---------- the new frame: Home, More, back, monthly report, Settings ----------
  await tab(c, 'Home')
  const home = await c.locator('main').innerText()
  assert.match(home, /Cash in hand today/)
  assert.match(home, /Shops owe you/)
  await c.getByRole('button', { name: /Receive goods/ }).click()           // a Home shortcut opens a page...
  await c.getByRole('heading', { name: 'Receive goods' }).waitFor()        // ...with its title in the header
  await c.getByRole('button', { name: 'Back' }).click()                    // and the back arrow returns
  await c.getByRole('heading', { name: 'Today' }).waitFor()
  ok('Home: cash today, dues, shortcuts open pages with a header and a working back arrow')

  await tab(c, 'Monthly report')
  const month = sale.sale_date.slice(0, 7)
  const report = await c.locator('main').innerText()
  assert.match(report, /Cash in this month/)
  assert.match(report, /Sold \(bills\)/)
  await c.locator('tbody tr').first().click()                              // tap a day -> that day opens
  await c.getByRole('heading', { name: 'Day' }).waitFor()
  assert.equal(await c.locator('input[type="date"]').inputValue(), `${month}-${sale.sale_date.slice(8)}`)
  await c.getByRole('button', { name: 'Back' }).click()
  await c.getByText('Cash in this month').waitFor()
  ok('Monthly report opens; tapping a day opens that day; back returns to the report')

  await tab(c, 'Settings')
  await c.getByRole('button', { name: 'Sign out' }).click()
  const dialog = c.getByRole('dialog', { name: 'Sign out?' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'No, stay' }).click()
  assert.equal(await c.getByRole('dialog').count(), 0)
  await c.getByRole('heading', { name: 'Settings' }).waitFor()            // still signed in
  server.state.offline = true                                             // signing out with no internet: warned, still works
  await c.locator('section', { hasText: 'Waiting to sync' }).getByRole('button', { name: /Sync now/ }).click()
  await c.locator('section', { hasText: 'Waiting to sync' }).getByText('Offline', { exact: true }).waitFor()
  await c.getByRole('button', { name: 'Sign out' }).click()
  assert.match(await c.getByRole('dialog').innerText(), /You are offline/)
  await c.getByRole('button', { name: 'Yes, sign out' }).click()
  await c.getByPlaceholder('Email').waitFor()
  server.state.offline = false
  ok('Sign out asks Yes/No; "No" keeps you in; offline it warns, and "Yes" signs out even with no internet')

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join(' | ')}`)
  ok('no errors in the browser console')
  console.log('\nE2E PASSED')
} catch (e) {
  console.error('\nE2E FAILED:', e.message)
  console.error('browser errors:', pageErrors)
  process.exitCode = 1
} finally {
  await browser.close()
  preview.kill()
}
