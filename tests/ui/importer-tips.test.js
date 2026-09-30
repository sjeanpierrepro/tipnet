import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';

const seed = (nights = []) =>
  realState((S) => {
    S.settings.setupDone = true;
    S.nightsExample = false;
    S.profile.payTypes = [{ id: 'p1', k: 'hourly', name: 'Bartending', rate: 12, unit: 'hr', usual: 7 }];
    S.nights = nights;
  });
async function pickFile(page, name, text) {
  const input = page.must(page.$('input[type=file]', page.app), 'file input');
  Object.defineProperty(input, 'files', { value: [{ name, text: async () => text }], configurable: true });
  page.change(input);
  await page.settle();
}

test('importer: a "Total Tips" column imports as tips, plus hours at the hourly rate', async () => {
  const page = await boot({ url: 'http://localhost/', seed: seed() });
  try {
    page.tab('setup');
    await pickFile(
      page,
      'x.csv',
      'Date,Total Tips,Hours\n2026-09-05,300,7\n2026-09-06,200,25\n2026-09-07,100,"7,5"',
    );
    assert.equal(page.$('#map-tips').value, '1');
    assert.equal(page.$('#map-total').value, '');
    const t = page.text();
    assert.match(t, /2 nights ready to import/);
    assert.match(t, /Row 3: hours we could not read, or more than 24/);
    page.click(page.button('Import 2 nights'));
    await page.settle();
    const n = page.state().nights.find((x) => x.date === '2026-09-05');
    assert.equal(n.total, 384); // 300 tips + 7 h x $12
    assert.equal(n.tips, 300);
    assert.deepEqual(n.pay, { p1: 7 });
    assert.equal(page.state().nights.find((x) => x.date === '2026-09-07').pay.p1, 7.5);
  } finally {
    await page.close();
  }
});

test('importer: Replace says it replaces every night on the date, and does', async () => {
  const two = [
    { id: 'a', date: '2026-09-05', total: 50, cash: 10, pay: { p1: 4 }, barback: true },
    { id: 'b', date: '2026-09-05', total: 40, cash: 5, pay: { p1: 3 }, barback: true },
  ];
  const page = await boot({ url: 'http://localhost/', seed: seed(two) });
  try {
    page.tab('setup');
    await pickFile(page, 'x.csv', 'Date,Total\n2026-09-05,200');
    assert.match(page.text(), /replaces 2 nights on/i);
    const replace = page.$$('input[name="dup-choice"]')[1];
    replace.checked = true;
    page.change(replace);
    page.click(page.button('Import 1 night'));
    await page.settle();
    const on5 = page.state().nights.filter((n) => n.date === '2026-09-05');
    assert.equal(on5.length, 1);
    assert.equal(on5[0].total, 200);
  } finally {
    await page.close();
  }
});

test('importer: no hourly pay type means hours are not imported, with a note', async () => {
  const page = await boot({
    url: 'http://localhost/',
    seed: realState((S) => {
      S.settings.setupDone = true;
      S.nightsExample = false;
      S.profile.payTypes = [{ id: 'p1', k: 'shift', name: 'Flat', rate: 80, unit: 'shift', usual: 1 }];
      S.nights = [];
    }),
  });
  try {
    page.tab('setup');
    await pickFile(page, 'x.csv', 'Date,Tips,Hours\n2026-09-05,100,7');
    assert.match(page.text(), /Hours were not imported/);
    page.click(page.button('Import 1 night'));
    await page.settle();
    const n = page.state().nights[0];
    assert.equal(n.total, 100);
    assert.deepEqual(n.pay, {});
  } finally {
    await page.close();
  }
});
