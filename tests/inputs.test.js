import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, cutoffFromSettings, checkCash, negativeCheckReason } from '../app/js/inputs.js';
import { computeNight } from '../app/js/math.js';

test('businessDate: before the cutoff the shift belongs to yesterday', () => {
  assert.equal(businessDate(new Date(2026, 8, 29, 1, 30), 6), '2026-09-28');
  assert.equal(businessDate(new Date(2026, 8, 29, 5, 59), 6), '2026-09-28');
  assert.equal(businessDate(new Date(2026, 8, 29, 6, 0), 6), '2026-09-29');
  assert.equal(businessDate(new Date(2026, 8, 29, 22, 0), 6), '2026-09-29');
});
test('businessDate: default is 6 a.m., 0 turns it off, month and year edges', () => {
  assert.equal(businessDate(new Date(2026, 8, 29, 3, 0)), '2026-09-28');
  assert.equal(businessDate(new Date(2026, 8, 29, 3, 0), 0), '2026-09-29');
  assert.equal(businessDate(new Date(2026, 2, 1, 2, 0), 6), '2026-02-28');
  assert.equal(businessDate(new Date(2027, 0, 1, 3, 0), 6), '2026-12-31');
});
test('businessDate: daylight-saving nights (US dates; still correct in any zone)', () => {
  assert.equal(businessDate(new Date(2026, 2, 8, 3, 30), 6), '2026-03-07'); // spring forward
  assert.equal(businessDate(new Date(2026, 2, 9, 1, 0), 6), '2026-03-08');
  assert.equal(businessDate(new Date(2026, 10, 1, 1, 30), 6), '2026-10-31'); // fall back
  assert.equal(businessDate(new Date(2026, 10, 1, 6, 0), 6), '2026-11-01');
});
test('cutoffFromSettings reads defensively', () => {
  assert.equal(cutoffFromSettings(undefined), 6);
  assert.equal(cutoffFromSettings({}), 6);
  assert.equal(cutoffFromSettings({ dayCutoffHour: 0 }), 0);
  assert.equal(cutoffFromSettings({ dayCutoffHour: 4 }), 4);
  assert.equal(cutoffFromSettings({ dayCutoffHour: '4' }), 6);
  assert.equal(cutoffFromSettings({ dayCutoffHour: 30 }), 6);
});
test('checkCash: none, ok, negative, over', () => {
  assert.equal(checkCash('100', '').status, 'none');
  assert.equal(checkCash('100', '-').status, 'none');
  assert.equal(checkCash('100', '40').status, 'ok');
  assert.equal(checkCash('100', '100').status, 'ok');
  assert.equal(checkCash('', '40').status, 'ok'); // no total yet: nothing to compare against
  assert.equal(checkCash('100', '-5').status, 'negative');
  const over = checkCash('100', '5000');
  assert.equal(over.status, 'over');
  assert.match(over.message, /Cash is more than what you made tonight\. Check the number\./);
});
const prof = {
  payTypes: [{ id: 'p1', k: 'hourly', name: 'Hourly', unit: 'hr', rate: 5, usual: 8 }],
  deductions: [{ id: 'd1', k: 'tax', name: 'Taxes', amount: 20, mode: 'pct' }],
  gross: 100,
  shifts: 1,
  tipout: { on: false },
};
test('negativeCheckReason only blames taxes when taxes cause it', () => {
  const n = { total: 100, cash: 90, pay: { p1: 8 }, barback: true };
  const ok = computeNight({ ...n, cash: 20 }, prof, 1);
  assert.equal(negativeCheckReason(ok), null);
  assert.equal(negativeCheckReason({ onCheck: null }), null);
  const c = computeNight(n, prof, 1); // cash 90 of 100, taxes 20% -> negative from taxes
  assert.ok(c.onCheck < 0);
  assert.equal(negativeCheckReason(c), 'taxes');
  const fixed = { onCheck: -5, kept: 100, extra: 0, cashInHand: 50, tax: 10 }; // 100-50-10 = 40 left, so fixed deductions did it
  assert.equal(negativeCheckReason(fixed), 'fixed');
});

import { parseHoursInput } from '../app/js/inputs.js';
test('parseHoursInput: 7:30 is 7.5, plain and worded hours work, junk is 0', () => {
  assert.equal(parseHoursInput('7:30'), 7.5);
  assert.equal(parseHoursInput('8'), 8);
  assert.equal(parseHoursInput('7.5'), 7.5);
  assert.equal(parseHoursInput('7h 30m'), 7.5);
  assert.equal(parseHoursInput(''), 0);
  assert.equal(parseHoursInput('abc'), 0);
  assert.equal(parseHoursInput('730'), 730);
});
