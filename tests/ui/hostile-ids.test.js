import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, toCode, realState } from './harness.js';
import { migrate, safeId } from '../../app/js/storage.js';
import { todayISO, addDays } from '../../app/js/math.js';

const SAFE = /^[A-Za-z0-9_-]{1,40}$/;
const W1 = 'w"1\']';
const W2 = 'a b"]';
const PT = 'p"x';
const BILL = 'b"1@';
const CAT = "c'1";

/** A backup someone hand-edited: ids with quotes, spaces and brackets everywhere ids are referenced. */
function hostile() {
  return realState((S) => {
    const w = S.workplaces[0];
    w.id = W1;
    w.setupDone = true;
    w.profile.payTypes[0].id = PT;
    const w2 = JSON.parse(JSON.stringify(w));
    w2.id = W2;
    w2.name = 'Second';
    S.workplaces.push(w2);
    const d = addDays(todayISO(), -1);
    S.nights = [
      { id: 'n"1', date: d, total: 300, cash: 50, pay: { [PT]: 6 }, barback: true, workplaceId: W1 },
      { id: 'n 2', date: d, total: 200, cash: null, pay: { [PT]: 5 }, barback: true, workplaceId: W2 },
    ];
    S.settings.activeWorkplaceId = W2;
    S.settings.periodsFilter = W2;
    S.budget = {
      bills: [{ id: BILL, name: 'Rent', amount: 900, dueDay: 1, since: '2026-01-01' }],
      categories: [{ id: CAT, name: 'Food', monthly: 300 }],
      spends: [{ id: 's"1', date: d, amount: 12, categoryId: CAT }],
      goals: [{ id: 'g"1', name: 'Car', target: 1000, saved: 0, perPaycheck: 50, fundedBy: W2 }],
      paidBills: { [BILL + '@2026-01-01']: true },
    };
  });
}

test('ids: unsafe ids are rewritten on load and every reference follows', () => {
  const S = migrate(hostile());
  const [a, b] = S.workplaces;
  assert.match(a.id, SAFE);
  assert.match(b.id, SAFE);
  assert.notEqual(a.id, b.id);
  assert.equal(a.id, safeId(W1));
  assert.equal(S.settings.activeWorkplaceId, b.id);
  assert.equal(S.settings.periodsFilter, b.id);
  assert.deepEqual(
    S.nights.map((n) => n.workplaceId),
    [a.id, b.id],
  );
  const pt = a.profile.payTypes[0].id;
  assert.match(pt, SAFE);
  S.nights.forEach((n) => {
    assert.match(n.id, SAFE);
    assert.deepEqual(Object.keys(n.pay), [pt]);
  });
  const B = S.budget;
  assert.match(B.bills[0].id, SAFE);
  assert.deepEqual(Object.keys(B.paidBills), [B.bills[0].id + '@2026-01-01']);
  assert.match(B.categories[0].id, SAFE);
  assert.equal(B.spends[0].categoryId, B.categories[0].id);
  assert.equal(B.goals[0].fundedBy, b.id);
  // loading again changes nothing (safe ids stay as they are)
  assert.deepEqual(
    migrate(S).workplaces.map((w) => w.id),
    [a.id, b.id],
  );
});

test('ids: a restored backup with hostile ids renders and works on every tab', async () => {
  const page = await boot({ seed: realState((S) => (S.workplaces[0].setupDone = true)), payments: true });
  try {
    page.tab('setup');
    page.type(page.must(page.$('#bk-code'), '#bk-code'), toCode(hostile()));
    page.click(page.button('Restore from code'));
    await page.settle();
    const S = page.state();
    assert.equal(S.workplaces.length, 2);
    S.workplaces.forEach((w) => assert.match(w.id, SAFE));
    for (const t of ['tonight', 'periods', 'setup']) {
      page.tab(t);
      assert.doesNotMatch(page.text(), /Something went wrong/, t);
    }
    // switching restaurants on Tonight (focus is found by key) and renaming in Setup (buttons found by id) still work
    page.tab('tonight');
    const first = page.$$('[data-workplace]').find((b) => b.textContent.includes('My restaurant'));
    page.click(page.must(first, 'restaurant switch'));
    assert.equal(page.state().settings.activeWorkplaceId, S.workplaces[0].id);
    assert.doesNotMatch(page.text(), /Something went wrong/);
  } finally {
    await page.close();
  }
});
