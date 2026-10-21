import test from 'node:test'
import assert from 'node:assert/strict'
import { toUnits, toDecimalString, toNumber } from '../src/local/units.js'

test('toUnits parses decimals exactly', () => {
  assert.equal(toUnits('7.5416'), 75416)
  assert.equal(toUnits(7.5416), 75416)
  assert.equal(toUnits(400), 4000000)
  assert.equal(toUnits('0.1'), 1000)
  assert.equal(toUnits('.5'), 5000)
  assert.equal(toUnits('12.'), 120000)
  assert.equal(toUnits(null), null)
  assert.equal(toUnits(''), null)
  assert.equal(toUnits('-3.25'), -32500)
})
test('toUnits rounds half away from zero at the 5th decimal', () => {
  assert.equal(toUnits('0.00005'), 1)
  assert.equal(toUnits('0.00004'), 0)
  assert.equal(toUnits('-0.00005'), -1)
})
test('toUnits rejects junk', () => {
  assert.throws(() => toUnits('abc'))
  assert.throws(() => toUnits('1.2.3'))
  assert.throws(() => toUnits('.'))
})
test('0.1 + 0.2 style sums are exact', () => {
  assert.equal(toUnits('0.1') + toUnits('0.2'), toUnits('0.3'))
})
test('toDecimalString round trips', () => {
  for (const s of ['0', '7.5416', '400', '0.07', '12.3', '1234567.8901']) {
    assert.equal(toDecimalString(toUnits(s)), s)
  }
  assert.equal(toDecimalString(null), null)
  assert.equal(toDecimalString(-32500), '-3.25')
})
test('toNumber', () => {
  assert.equal(toNumber(75416), 7.5416)
  assert.equal(toNumber(null), null)
})
