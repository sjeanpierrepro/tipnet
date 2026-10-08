// v38 review 3: CSV hours cells use the screens' strict hours rules; the screens accept a decimal comma with a unit and "1 shift".
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, buildNights } from '../app/js/csv.js';
import { hoursTypo, parseHoursInput } from '../app/js/inputs.js';

const build = (cell) =>
  buildNights([['9/5/2026', '300', cell]], { date: 0, tips: 1, hours: 2 }, { rate: 12, payId: 'p1' });

test('CSV: an hours cell the screens refuse skips the row with reason hours', () => {
  for (const bad of ['1.2.3', '7..5', '12abc', '7h abc', 'seven', 'off', '7 shifts']) {
    const { nights, skipped } = build(bad);
    assert.equal(nights.length, 0, bad);
    assert.deepEqual(skipped, [{ row: 1, reason: 'hours' }], bad);
  }
});

test('CSV: good, blank and placeholder hours cells still import', () => {
  for (const [cell, h] of [
    ['7.5', 7.5],
    ['7:30', 7.5],
    ['7,5 h', 7.5],
    ['7h 30m', 7.5],
    ['8hrs.', 8],
  ]) {
    const { nights, skipped } = build(cell);
    assert.equal(skipped.length, 0, cell);
    assert.equal(nights[0].pay.p1, h, cell);
  }
  for (const blank of ['', ' ', 'n/a', 'N/A', 'na', 'none', '-', '--', '—']) {
    const { nights, skipped } = build(blank);
    assert.equal(skipped.length, 0, JSON.stringify(blank));
    assert.equal(nights[0].total, 300, JSON.stringify(blank));
  }
  assert.equal(parseHours('n/a'), 0);
  assert.ok(Number.isNaN(parseHours('1.2.3')));
});

test('hours box: decimal comma with a unit, .5h, and 7½h are accepted with the right value', () => {
  for (const [t, v] of [
    ['7,5 h', 7.5],
    ['7,5h', 7.5],
    ['7,5 hrs', 7.5],
    ['7,25 hours', 7.25],
    ['.5h', 0.5],
    ['7½h', 7.5],
    ['7½ hrs', 7.5],
    ['7,5', 7.5],
  ]) {
    assert.equal(hoursTypo(t), '', t);
    assert.equal(parseHoursInput(t), v, t);
  }
  // still refused
  for (const t of ['1,250 h', '7,555h', '7,5,5h', '7 shifts', '1 shift'])
    assert.notEqual(hoursTypo(t), '', t);
});

test('shifts box accepts "1 shift" and "2 shifts"', () => {
  for (const [t, v] of [
    ['1 shift', 1],
    ['2 shifts', 2],
    ['1.5 shifts', 1.5],
    ['2shifts', 2],
    ['1,5 shifts', 1.5],
  ]) {
    assert.equal(hoursTypo(t, 'shifts'), '', t);
    assert.equal(parseHoursInput(t), v, t);
  }
  assert.notEqual(hoursTypo('shifts', 'shifts'), '');
  assert.notEqual(hoursTypo('1 shiftt', 'shifts'), '');
  assert.match(hoursTypo('x', 'shifts'), /shifts/);
});
