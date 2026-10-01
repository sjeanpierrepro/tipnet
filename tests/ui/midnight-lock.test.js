// A pay period that ends while a question or an editor is open must not lose the save (review 6, item 2).
// lockFinished stamps the nights in place and every write looks the night up by id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import * as storage from '../../app/js/storage.js';
import { addDays, todayISO, periodIndex, periodRange } from '../../app/js/math.js';

const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
  });
const totalInput = (page) => page.must(page.$('[data-focus-key="night-total"]'), 'total field');
const hoursInput = (page) => page.must(page.$('[data-focus-key="night-pay-p1"]'), 'hours field');
const submit = (page) => page.click(page.$('form button[type=submit]'));
/** Lock as if the current pay period has just ended (the next day after its end). */
const lockNow = (page) => {
  const S = page.state();
  const p = S.workplaces[0].profile;
  const end = periodRange(p, periodIndex(p, todayISO())).end;
  return storage.lockFinished({ force: true, today: addDays(end, 1) });
};
const noStrayKeys = (S) =>
  assert.deepEqual(
    Object.keys(S.nights).filter((k) => !/^\d+$/.test(k)),
    [],
    'nothing written to a "-1" property',
  );

test('lockFinished stamps nights in place: the same objects and the same array', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '100');
    page.type(hoursInput(page), '6');
    submit(page);
    const S = page.state();
    const arr = S.nights,
      night = S.nights[0];
    assert.equal(lockNow(page), 1);
    assert.equal(S.nights, arr);
    assert.equal(S.nights[0], night);
    assert.ok(night.snap, 'the held reference got the lock');
  } finally {
    await page.close();
  }
});

for (const [btn, total] of [
  ['dup-add', 250],
  ['dup-replace', 150],
]) {
  test('Tonight same-date question: ' + btn + ' still saves after the period locks', async () => {
    const page = await boot({ seed: seed() });
    try {
      page.type(totalInput(page), '100');
      page.type(hoursInput(page), '6');
      submit(page);
      page.type(totalInput(page), '150');
      page.type(hoursInput(page), '4');
      submit(page);
      assert.ok(page.$('[data-focus-key="' + btn + '"]'), 'the question is shown');
      assert.equal(lockNow(page), 1); // midnight passes while the question is open
      page.click(page.$('[data-focus-key="' + btn + '"]'));
      const S = page.state();
      assert.equal(S.nights.length, 1);
      assert.equal(S.nights[0].total, total);
      assert.ok(S.nights[0].snap, 'it keeps its lock');
      noStrayKeys(S);
      assert.match(page.text(), /Saved\./);
    } finally {
      await page.close();
    }
  });
}

test('Tonight same-date question: a night swapped for a copy (another window) is still found by id', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '100');
    page.type(hoursInput(page), '6');
    submit(page);
    page.type(totalInput(page), '150');
    page.type(hoursInput(page), '4');
    submit(page);
    const S = page.state();
    S.nights[0] = { ...S.nights[0] }; // what a merge from another window can do
    page.click(page.$('[data-focus-key="dup-add"]'));
    assert.equal(S.nights.length, 1);
    assert.equal(S.nights[0].total, 250);
    noStrayKeys(S);
  } finally {
    await page.close();
  }
});

test('Night editor: saving after the period locks updates the night and keeps its lock', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.nights = [{ id: 'n1', date: todayISO(), total: 300, cash: 80, pay: { p1: 6 }, barback: true }];
    }),
  });
  try {
    page.tab('periods');
    const row = page.must(page.$('.list-row', page.app), 'night row');
    page.click(page.byLabel('Edit night ' + row.querySelector('.main div').textContent));
    const form = page.must(page.$('section[data-period] form', page.app), 'editor');
    assert.equal(lockNow(page), 1);
    page.type(
      page.must(form.querySelector('[data-focus-key$="total"], input[inputmode=decimal]'), 'total'),
      '320',
    );
    page.click(page.button('Save changes', form));
    const S = page.state();
    assert.equal(S.nights.length, 1);
    assert.equal(S.nights[0].total, 320);
    assert.ok(S.nights[0].snap, 'still locked');
    noStrayKeys(S);
  } finally {
    await page.close();
  }
});

test('Undo a deleted night after a lock brings it back once', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.nights = [{ id: 'n1', date: todayISO(), total: 300, cash: 80, pay: { p1: 6 }, barback: true }];
    }),
  });
  try {
    page.tab('periods');
    const del = page.must(page.$('.list-row .btn-danger', page.app), 'delete');
    page.click(del);
    page.click(del);
    assert.equal(page.state().nights.length, 0);
    lockNow(page);
    const undo = page.button('Undo', page.$('#toast'));
    page.click(undo);
    page.click(undo);
    assert.equal(page.state().nights.length, 1);
    noStrayKeys(page.state());
  } finally {
    await page.close();
  }
});
