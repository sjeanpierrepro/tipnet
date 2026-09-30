import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';

// Header row, then: two good Sam rows, one Alex row (filtered out by the employee pick),
// and three Sam rows that are skipped for a different reason each.
const CSV = [
  'Date,Employee,Total,Cash',
  '2026-09-01,Sam,120,40',
  '2026-09-02,Sam,90,30',
  '2026-09-03,Alex,999,1',
  'not-a-date,Sam,50,5',
  '2026-09-04,Sam,-5,0',
  '2026-09-05,Sam,,',
].join('\n');

const seed = () =>
  realState((S) => {
    S.settings.setupDone = true;
    // 09-02 already has a night, so it is a duplicate date in the file
    S.nights = [{ id: 'ex', date: '2026-09-02', total: 50, cash: 10, pay: {}, barback: true }];
  });

/** Pick a file the way a browser does: the input's files list, then a change event. */
async function pickFile(page, name, text) {
  const input = page.must(page.$('input[type=file]', page.app), 'file input');
  Object.defineProperty(input, 'files', { value: [{ name, text: async () => text }], configurable: true });
  page.change(input);
  await page.settle();
}
const chooseEmployee = async (page, who) => {
  const s = page.must(page.$('#map-me'), 'employee select');
  s.value = who;
  page.change(s);
  await page.settle();
};

test('importer: choosing a file guesses the columns and asks which employee you are', async () => {
  const page = await boot({ url: 'http://localhost/', seed: seed() });
  try {
    page.tab('setup');
    await pickFile(page, 'tips.csv', CSV);
    assert.match(page.text(), /tips\.csv: first rows/);
    assert.equal(page.$('#map-date').value, '0');
    assert.equal(page.$('#map-employee').value, '1');
    assert.equal(page.$('#map-total').value, '2');
    assert.equal(page.$('#map-cash').value, '3');
    assert.equal(page.$('#map-card').value, '', 'no card column in this file');
    const names = page.$$('#map-me option').map((o) => o.textContent);
    assert.deepEqual(names, ['Choose your name', 'Alex', 'Sam']);
    assert.match(page.text(), /Choose your name above to see a preview/);
  } finally {
    await page.close();
  }
});

test('importer: employee filter, skipped-row reasons, and Keep skips duplicate dates', async () => {
  const page = await boot({ url: 'http://localhost/', seed: seed() });
  try {
    page.tab('setup');
    await pickFile(page, 'tips.csv', CSV);
    await chooseEmployee(page, 'Sam');
    const t = page.text();
    assert.match(t, /2 nights ready to import/); // 09-01 and 09-02; Alex's row is not counted
    assert.match(t, /3 rows skipped/);
    assert.match(t, /Row 5: no date we could read/);
    assert.match(t, /Row 7: no amount/);
    assert.match(t, /Row 6: a negative amount or hours/);
    assert.match(t, /1 of these dates already has a night saved/);
    page.click(page.button('Import 2 nights'));
    await page.settle();
    const nights = page.state().nights;
    assert.equal(nights.length, 2);
    assert.equal(nights.find((n) => n.date === '2026-09-02').total, 50, 'kept what was there');
    assert.equal(nights.find((n) => n.date === '2026-09-01').total, 120);
    assert.ok(!nights.some((n) => n.date === '2026-09-03'), "Alex's night was not imported");
    assert.match(page.$('#toast').textContent, /Imported 1 night, skipped 1 duplicate date/);
    assert.deepEqual(
      page.state().settings.csvMapping.employee,
      'employee',
      'mapping remembered by header name',
    );
  } finally {
    await page.close();
  }
});

test('importer: Replace overwrites the night on a duplicate date and keeps its id', async () => {
  const page = await boot({ url: 'http://localhost/', seed: seed() });
  try {
    page.tab('setup');
    await pickFile(page, 'tips.csv', CSV);
    await chooseEmployee(page, 'Sam');
    const replace = page.$$('input[name="dup-choice"]')[1];
    replace.checked = true;
    page.change(replace);
    page.click(page.button('Import 2 nights'));
    await page.settle();
    const nights = page.state().nights;
    assert.equal(nights.length, 2);
    const dup = nights.find((n) => n.date === '2026-09-02');
    assert.equal(dup.total, 90);
    assert.equal(dup.cash, 30);
    assert.equal(dup.id, 'ex');
    assert.match(page.$('#toast').textContent, /Imported 2 nights/);
  } finally {
    await page.close();
  }
});

test('importer: a file that is not a CSV shows a plain message and nothing is imported', async () => {
  const page = await boot({ url: 'http://localhost/', seed: seed() });
  try {
    page.tab('setup');
    await pickFile(page, 'notes.txt', 'just one lonely column');
    assert.match(page.text(), /could not be read as a CSV/);
    assert.equal(page.state().nights.length, 1);
  } finally {
    await page.close();
  }
});
