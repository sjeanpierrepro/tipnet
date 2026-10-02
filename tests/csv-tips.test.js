import test from 'node:test';
import assert from 'node:assert/strict';
import { guessMapping, buildNights, parseHours, mergeNights, dedupeNights } from '../app/js/csv.js';

test('guessMapping: a "Total Tips" column is Tips, "Total" / "Earnings" is Total', () => {
  assert.deepEqual(guessMapping(['Date', 'Total Tips', 'Hours']), {
    date: 0,
    total: null,
    tips: 1,
    cash: null,
    card: null,
    hours: 2,
    employee: null,
  });
  assert.equal(guessMapping(['Date', 'Tips Total']).tips, 1);
  assert.equal(guessMapping(['Date', 'Tips']).tips, 1);
  assert.equal(guessMapping(['Date', 'Nightly tips']).tips, 1);
  assert.equal(guessMapping(['Date', 'Cash Tips', 'Card Tips']).tips, null);
  const m = guessMapping(['Date', 'Earnings']);
  assert.equal(m.total, 1);
  assert.equal(m.tips, null);
});

test('tips + hours x rate = total, and the night stores tips', () => {
  const { nights } = buildNights(
    [['9/5/2026', '$300', '7']],
    { date: 0, tips: 1, hours: 2 },
    { rate: 12, payId: 'p1' },
  );
  assert.equal(nights[0].total, 384);
  assert.equal(nights[0].tips, 300);
  assert.deepEqual(nights[0].pay, { p1: 7 });
});

test('cash + card (no Total) adds up and stores tips = cash + card, like a Tips column', () => {
  const { nights } = buildNights(
    [
      ['9/5/2026', '100', '50', '2'],
      ['9/6/2026', '40', '', '3'],
      ['9/6/2026', '', '25.5', '1'],
    ],
    { date: 0, cash: 1, card: 2, hours: 3 },
    { rate: 10 },
  );
  assert.equal(nights[0].total, 170);
  assert.equal(nights[0].tips, 150, 'a later pay-rate fix moves only the pay part, never these tips');
  assert.equal(nights[0].cash, 100);
  assert.equal(nights[1].total, 105.5, 'same-date rows are summed');
  assert.equal(nights[1].tips, 65.5);
});

test('cash + card with a Total column: Total wins and no tips are stored', () => {
  const { nights } = buildNights(
    [['9/5/2026', '100', '50', '2', '400']],
    { date: 0, cash: 1, card: 2, hours: 3, total: 4 },
    { rate: 10 },
  );
  assert.equal(nights[0].total, 400);
  assert.equal(nights[0].tips, undefined);
});

test('parseHours: comma decimals and ambiguous thousands', () => {
  assert.equal(parseHours('7,5'), 7.5);
  assert.equal(parseHours('7,25'), 7.25);
  assert.equal(parseHours('7.5'), 7.5);
  assert.ok(Number.isNaN(parseHours('1,250')));
});

test('hours over 24 or ambiguous are skipped with reason hours', () => {
  const rows = [
    ['9/1/2026', '100', '25'],
    ['9/2/2026', '100', '1,250'],
    ['9/3/2026', '100', '7,5'],
  ];
  const { nights, skipped } = buildNights(rows, { date: 0, tips: 1, hours: 2 }, { rate: 10 });
  assert.deepEqual(skipped, [
    { row: 1, reason: 'hours' },
    { row: 2, reason: 'hours' },
  ]);
  assert.equal(nights[0].pay.p1, 7.5);
});

test('no hourly pay type (payId null): hours are ignored', () => {
  const { nights } = buildNights(
    [['9/1/2026', '100', '7']],
    { date: 0, tips: 1, hours: 2 },
    { rate: 0, payId: null },
  );
  assert.equal(nights[0].total, 100);
  assert.deepEqual(nights[0].pay, {});
});

test('Replace removes every existing night on that date', () => {
  const existing = [
    { id: 1, date: '2026-09-05', total: 50, cash: 10, pay: { p1: 4 }, barback: true },
    { id: 2, date: '2026-09-05', total: 40, cash: 5, pay: { p1: 3 }, barback: true },
    { id: 3, date: '2026-09-06', total: 10, cash: null, pay: {}, barback: true },
  ];
  const incoming = [
    { id: 9, date: '2026-09-05', total: 200, cash: null, tips: 150, pay: { p1: 7 }, barback: true },
  ];
  assert.equal(dedupeNights(incoming, existing).duplicates[0].existingAll.length, 2);
  const keep = mergeNights(existing, incoming, { overwrite: false });
  assert.equal(keep.nights.length, 3);
  const r = mergeNights(existing, incoming, { overwrite: true });
  assert.equal(r.nights.filter((n) => n.date === '2026-09-05').length, 1);
  assert.equal(r.nights.length, 2);
  assert.equal(r.removed, 2);
  const n = r.nights.find((x) => x.date === '2026-09-05');
  assert.equal(n.total, 200);
  assert.equal(n.cash, null);
  assert.deepEqual(n.pay, { p1: 7 });
});

test('Total mapped wins over Tips: total stored as is, no night.tips', () => {
  const { nights } = buildNights(
    [['9/5/2026', '$300', '7', '$320']],
    { date: 0, tips: 1, hours: 2, total: 3 },
    { rate: 12, payId: 'p1' },
  );
  assert.equal(nights[0].total, 320);
  assert.equal(nights[0].tips, undefined);
});

test('Total mapped with a blank total on one row: that row falls back to tips + pay, and the date stores no tips', () => {
  const { nights } = buildNights(
    [
      ['9/5/2026', '$100', '', '$150'],
      ['9/5/2026', '$50', '', ''],
    ],
    { date: 0, tips: 1, total: 3 },
    {},
  );
  assert.equal(nights[0].total, 200);
  assert.equal(nights[0].tips, undefined);
});
