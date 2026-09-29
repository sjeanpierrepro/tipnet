import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseMoney, parseDate, buildNights, dedupeNights, mergeNights, guessMapping, listEmployees, MAPPING_PRESETS, namesToMapping, mappingToNames } from '../app/js/csv.js';
import { csvSource, toastSource } from '../app/js/integrations/source.js';

test('parseCSV: quotes, escaped quotes, commas and newlines in quotes, BOM, CRLF', () => {
  const t = '﻿Date,Note,Amt\r\n9/26,"Hello, ""world""",$1.50\r\n9/27,"line1\nline2",2\r\n';
  assert.deepEqual(parseCSV(t), [['Date', 'Note', 'Amt'], ['9/26', 'Hello, "world"', '$1.50'], ['9/27', 'line1\nline2', '2']]);
});

test('parseCSV: no trailing newline, blank lines, empty fields, lone CR', () => {
  assert.deepEqual(parseCSV('a,b\n\n1,\n,2'), [['a', 'b'], ['1', ''], ['', '2']]);
  assert.deepEqual(parseCSV('a\rb'), [['a'], ['b']]);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('x,"",y'), [['x', '', 'y']]);
});

test('parseMoney', () => {
  assert.equal(parseMoney('$1,234.50'), 1234.5);
  assert.equal(parseMoney(' 12 '), 12);
  assert.equal(parseMoney('(45.00)'), -45);
  assert.equal(parseMoney('-$3'), -3);
  assert.equal(parseMoney('€7,5'.replace(',', '.')), 7.5);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.2.3'), null);
  assert.equal(parseMoney(null), null);
});

test('parseDate: all supported formats', () => {
  assert.equal(parseDate('2026-09-26'), '2026-09-26');
  assert.equal(parseDate('9/26/2026'), '2026-09-26');
  assert.equal(parseDate('09/06/26'), '2026-09-06');
  assert.equal(parseDate('9/26/99'), '1999-09-26');
  assert.equal(parseDate('9/26', 2025), '2025-09-26');
  assert.equal(parseDate('9/26/2026 10:30 PM'), '2026-09-26');
  assert.equal(parseDate('2026-09-26T22:00:00'), '2026-09-26');
  assert.equal(parseDate('2/30/2026'), null);
  assert.equal(parseDate('13/1/2026'), null);
  assert.equal(parseDate('garbage'), null);
  assert.equal(parseDate(''), null);
});

const HEAD = ['Business Date', 'Employee', 'Cash Tips', 'Card Tips', 'Hours', 'Total'];

test('guessMapping and saved-mapping round trip', () => {
  const m = guessMapping(HEAD);
  assert.deepEqual(m, { date: 0, total: 5, cash: 2, card: 3, hours: 4, employee: 1 });
  const names = mappingToNames(HEAD, m);
  assert.equal(names.date, 'business date');
  assert.deepEqual(namesToMapping(['Total', 'Business Date', 'Employee', 'Cash Tips', 'Card Tips', 'Hours'], names),
    { date: 1, total: 0, cash: 3, card: 4, hours: 5, employee: 2 });
  assert.ok(MAPPING_PRESETS.generic);
  assert.equal(MAPPING_PRESETS.toast, undefined);
});

test('buildNights: total column, employee filter, cash', () => {
  const rows = [
    ['9/26/2026', 'Sam', '$100', '$200', '8', '$390.50'],
    ['9/26/2026', 'Alex', '$10', '$20', '4', '$99'],
    ['9/27/2026', 'Sam', '', '', '5', '$250'],
    ['bad', 'Sam', '', '', '', '$1'],
  ];
  const m = guessMapping(HEAD);
  assert.deepEqual(listEmployees(rows, m), ['Alex', 'Sam']);
  const { nights, skipped } = buildNights(rows, m, { employee: 'Sam', payId: 'p1' });
  assert.equal(nights.length, 2);
  assert.deepEqual([nights[0].date, nights[0].total, nights[0].cash, nights[0].pay], ['2026-09-26', 390.5, 100, { p1: 8 }]);
  assert.equal(nights[1].cash, null);
  assert.deepEqual(skipped, [{ row: 4, reason: 'date' }]);
  assert.equal(nights[0].barback, true);
});

test('buildNights: total = cash + card + hours * rate when no total column', () => {
  const m = { date: 0, cash: 1, card: 2, hours: 3, total: null, employee: null };
  const { nights, skipped } = buildNights([['9/26', '$100.10', '200.20', '8'], ['9/27', '', '', '']], m, { rate: 12, refYear: 2026 });
  assert.equal(nights[0].total, 396.3);
  assert.equal(nights[0].date, '2026-09-26');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'amount');
});

test('buildNights sums several rows on the same date', () => {
  const m = { date: 0, total: 1, cash: 2, card: null, hours: null, employee: null };
  const { nights } = buildNights([['2026-09-26', '100', '10'], ['2026-09-26', '50.25', '5']], m, {});
  assert.equal(nights.length, 1);
  assert.equal(nights[0].total, 150.25);
  assert.equal(nights[0].cash, 15);
});

test('dedupe and merge', () => {
  const existing = [{ id: 1, date: '2026-09-26', total: 100 }, { id: 2, date: '2026-09-27', total: 50 }];
  const incoming = [{ id: 9, date: '2026-09-26', total: 999 }, { id: 10, date: '2026-09-28', total: 70 }];
  const d = dedupeNights(incoming, existing);
  assert.equal(d.fresh.length, 1);
  assert.equal(d.duplicates.length, 1);
  const skip = mergeNights(existing, incoming);
  assert.equal(skip.nights.length, 3);
  assert.equal(skip.nights.find((n) => n.date === '2026-09-26').total, 100);
  assert.deepEqual([skip.added, skip.skipped, skip.replaced], [1, 1, 0]);
  const over = mergeNights(existing, incoming, { overwrite: true });
  assert.equal(over.nights.length, 3);
  const o = over.nights.find((n) => n.date === '2026-09-26');
  assert.equal(o.total, 999);
  assert.equal(o.id, 1);
  assert.deepEqual([over.added, over.replaced], [1, 1]);
});

test('csvSource returns nights in range; toastSource throws', async () => {
  const text = 'Date,Total\n9/26/2026,100\n9/27/2026,200\n';
  const src = csvSource({ text, mapping: { date: 0, total: 1, cash: null, card: null, hours: null, employee: null } });
  assert.equal(src.id, 'csv');
  assert.equal((await src.fetchNights()).length, 2);
  const r = await src.fetchNights({ from: '2026-09-27' });
  assert.deepEqual(r.map((n) => n.total), [200]);
  await assert.rejects(() => toastSource.fetchNights({}), /not available yet/);
  assert.equal(toastSource.id, 'toast');
});
