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
const tab = (page, name) => page.locator('nav button', { hasText: new RegExp(`^${name}$`) }).click()
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
  await a.getByText('Alauddin (nobigonj)').waitFor()
  assert.match(await a.locator('body').innerText(), /Due created by today's sales\s*200\.00/)
  ok('offline reload: app opens with no internet and the sale is still there')

  await tab(a, 'Dues')
  await a.getByText('Alauddin').first().waitFor()
  assert.match(await a.locator('body').innerText(), /Total to collect\s*200\.00/)
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
  await tab(a, 'Stock')
  await a.getByRole('button', { name: 'Receive' }).click()
  await a.getByPlaceholder('Search product').click()
  await a.locator('li', { hasText: 'cola' }).first().click()
  await a.getByPlaceholder('Cartons').first().fill('10')
  await a.getByPlaceholder('Cartons').nth(1).fill('9') // one carton short
  await a.getByRole('button', { name: 'Save delivery' }).click()
  await a.getByText('Delivery saved, stock updated').waitFor()
  await a.getByRole('button', { name: 'In stock' }).click()
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
  await tab(b, 'Stock')
  await b.getByRole('button', { name: 'In stock' }).click()
  assert.match(await b.locator('li', { hasText: 'cola' }).first().innerText(), /8 ctn/)
  await tab(b, 'Day')
  await b.locator('input[type="date"]').fill(sale.sale_date)
  await b.getByText('Alauddin (nobigonj)').waitFor()
  ok('second phone: signs in, downloads everything, same sale and same stock')

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
  await a.getByText('Alauddin (nobigonj)').waitFor()
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
