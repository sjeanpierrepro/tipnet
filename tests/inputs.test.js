import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDate,
  cutoffFromSettings,
  negativeCheckReason,
  readMoney,
  moneyTypo,
  hoursTypo,
  percentTypo,
} from '../app/js/inputs.js';
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
test('readMoney: a lone minus is a typo, not blank; -5 is read as a number below 0', () => {
  assert.equal(readMoney(''), null);
  assert.ok(Number.isNaN(readMoney('-')));
  assert.equal(readMoney('-5'), -5);
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

test('parseHoursInput: decimal commas; an ambiguous thousands comma is ignored', () => {
  assert.equal(parseHoursInput('7,5'), 7.5);
  assert.equal(parseHoursInput('7,25'), 7.25);
  assert.equal(parseHoursInput('-7,5'), -7.5);
  assert.equal(
    parseHoursInput('1,250'),
    1250,
    'screens: the comma is ignored and 1250 is refused as over 24',
  );
});

test('readMoney: accepted shapes', () => {
  const ok = {
    123: 123,
    '123.': 123,
    123.4: 123.4,
    123.45: 123.45,
    '.5': 0.5,
    ' 12.50 ': 12.5,
    '$12.50': 12.5,
    '1,250': 1250,
    '12,500.75': 12500.75,
    '1,000,000': 1000000,
    '1,5': 1.5,
    '12,50': 12.5,
    '1,250.50': 1250.5,
    '-5': -5,
    '−5': -5,
    '-$5.25': -5.25,
    '$ 12.50': 12.5,
    '12.50$': 12.5,
    '12.50 $': 12.5,
    '+12': 12,
    '+$12.50': 12.5,
    '-$ 5': -5,
    0: 0,
    1.23456: 1.23456,
  };
  for (const [t, n] of Object.entries(ok)) assert.equal(readMoney(t), n, t);
  assert.equal(Object.is(readMoney('-0'), 0), true, '-0 is plain 0');
});
test('readMoney: blank is null, everything else odd is NaN', () => {
  for (const t of ['', '   ', null, undefined]) assert.equal(readMoney(t), null, String(t));
  const bad = [
    '1.2.3',
    '12abc',
    '1,2,3',
    '12,345,6',
    '1.2,5',
    '$',
    '-',
    '.',
    '12 50',
    '1..2',
    'abc',
    '--5',
    '1,25,000',
    '$5$',
    '$ $5',
    '15%',
    '+-5',
    '- 12',
    '1,250,',
    '12,5,5',
    '1e3',
    '$$5',
    '1,2345',
  ];
  for (const t of bad) assert.ok(Number.isNaN(readMoney(t)), t);
});
test('moneyTypo: empty for blank and readable, a plain message for typos', () => {
  for (const t of ['', ' ', '12.50', '1,250.50', '-5', '$3']) assert.equal(moneyTypo(t), '', t);
  for (const t of ['1.2.3', '12abc', '$', '.']) assert.match(moneyTypo(t), /^That isn’t an amount\./, t);
});
test('readMoney percent: a trailing % is fine, money signs are not', () => {
  const ok = { 15: 15, '15%': 15, '1.25 %': 1.25, ' 12,5% ': 12.5, '+15%': 15, '.5%': 0.5, '-5%': -5 };
  for (const [t, n] of Object.entries(ok)) assert.equal(readMoney(t, { percent: true }), n, t);
  for (const t of ['%', '15%%', '1.2.3%', '15abc', '$15', '15$', '% 15'])
    assert.ok(Number.isNaN(readMoney(t, { percent: true })), t);
  assert.equal(readMoney('', { percent: true }), null);
  // a money box still refuses the % sign
  assert.ok(Number.isNaN(readMoney('15%')));
  assert.match(moneyTypo('15%'), /^That isn’t an amount\./);
});
test('percentTypo: percent wording, blank and readable are fine', () => {
  for (const t of ['', ' ', '15', '15%', '1.25 %']) assert.equal(percentTypo(t), '', t);
  for (const t of ['1.2.3', '15abc', '$15', '%'])
    assert.equal(percentTypo(t), 'That isn’t a percent. Use something like 15 or 1.25.', t);
});
test('hoursTypo: a period after the unit is fine and reads the same hours', () => {
  const ok = { '8hrs.': 8, '8 hrs.': 8, '7h 30m.': 7.5, '7 hours 30 min.': 7.5, '7.5h.': 7.5, '8h': 8 };
  for (const [t, n] of Object.entries(ok)) {
    assert.equal(hoursTypo(t), '', t);
    assert.equal(parseHoursInput(t), n, t);
  }
  for (const t of ['7..', '8abc.', 'h.', '8 hrs..']) assert.notEqual(hoursTypo(t), '', t);
});
test('hoursTypo: every shape parseHoursInput reads is fine, junk is not', () => {
  const ok = [
    '',
    ' ',
    '7',
    '7.',
    '7.5',
    '.5',
    '7,5',
    '7:30',
    '7:30:00',
    '7h',
    '7h 30m',
    '7 hours 30 min',
    '7hrs',
    '-5',
    '-7:30',
    '7.5h',
  ];
  for (const t of ok) assert.equal(hoursTypo(t), '', t);
  for (const t of ['1.2.3', '7..5', '7:3:3:3', 'abc', '7h abc', '-', '7:', '$7', '1,2,3', '7 30'])
    assert.match(hoursTypo(t), /^That isn’t a number of hours\./, t);
  assert.match(hoursTypo('x', 'shifts'), /number of shifts/);
});

test('hours: 7h30, 7:30 hrs, 7.5., fractions are read; typos still refused', () => {
  const ok = {
    '7h30': 7.5,
    '7h 30': 7.5,
    '7:30 hrs': 7.5,
    '7.5.': 7.5,
    '7 1/2': 7.5,
    '7½': 7.5,
    '1/2': 0.5,
    '7h 30m': 7.5,
    '8hrs.': 8,
    '7:30': 7.5,
    7.5: 7.5,
    '7,5': 7.5,
    '-7h30': -7.5,
  };
  for (const [s, v] of Object.entries(ok)) {
    assert.equal(parseHoursInput(s), v, s);
    assert.equal(hoursTypo(s), '', s);
  }
  for (const s of ['1.2.3', '7..5', '7:3:3:3', 'abc', '7h abc', '7 1/3'])
    assert.notEqual(hoursTypo(s), '', s);
});
