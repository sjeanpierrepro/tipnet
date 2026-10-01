// Two open copies of TipNet: copy B (simulated by writing to the shared storage, as its flush would) saves while this
// copy (A) is on a screen. Whatever A does next must land in A's state and on disk, whether B's save changed data or
// only its tab (what an older B wrote on every hide, close or reload).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import * as storage from '../../app/js/storage.js';
import { exampleBudget } from '../../app/js/budget.js';
import { todayISO, addDays } from '../../app/js/math.js';

const DEV = 'http://localhost/?unlock=dev';
const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.budget = exampleBudget();
    S.nights = [
      { id: 'n0', date: addDays(todayISO(), -1), total: 300, cash: null, pay: { p1: 6 }, barback: true, workplaceId: 'w1' },
    ];
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const disk = (page) => JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
let stamp = 0;

/** Copy B saves. withData: it also changed the theme and saved a night of its own; otherwise only its tab changed. */
async function otherWindowSaves(page, withData) {
  const theirs = disk(page);
  theirs.settings.lastTab = theirs.settings.lastTab === 'periods' ? 'setup' : 'periods';
  if (withData) {
    theirs.settings.theme = 'dark';
    theirs.nights.push({ ...theirs.nights[0], id: 'fromB' + ++stamp, date: addDays(todayISO(), -2), total: 111 });
  }
  theirs._savedAt = Date.now() + 1000 + ++stamp;
  theirs._writer = 'window-B';
  page.win.localStorage.setItem('tipnet.v2', JSON.stringify(theirs));
  await storage.syncFromStorage();
  await page.settle();
}
/** B's data (when it changed any) is kept next to A's change, in A's state and on disk. */
async function bothKept(page, withData) {
  await storage.flush();
  if (!withData) return;
  for (const S of [storage.getState(), disk(page)]) {
    assert.equal(S.settings.theme, 'dark', 'B’s change kept');
    assert.ok(
      S.nights.some((n) => String(n.id).startsWith('fromB')),
      'B’s night kept',
    );
  }
}

for (const withData of [false, true]) {
  const when = withData ? ' (B changed data)' : ' (B changed only its tab)';

  test('two copies: Tonight save in A after B saved' + when, async () => {
    const page = await boot({ seed: seed() });
    try {
      page.type(key(page, 'night-total'), '250');
      await otherWindowSaves(page, withData);
      assert.equal(key(page, 'night-total').value, '250', 'what A typed is still there');
      page.type(key(page, 'night-pay-p1'), '6');
      page.click(page.$('form button[type=submit]'));
      await page.settle();
      assert.match(page.text(), /Saved/);
      const mine = (S) => S.nights.filter((n) => n.total === 250).length;
      assert.equal(mine(storage.getState()), 1, 'in the state');
      await bothKept(page, withData);
      assert.equal(mine(disk(page)), 1, 'on disk');
    } finally {
      await page.close();
    }
  });

  test('two copies: Setup edit in A after B saved' + when, async () => {
    const page = await boot({ seed: seed() });
    try {
      page.tab('setup');
      await page.settle();
      await otherWindowSaves(page, withData);
      const gross = page.$$('input').find((i) => i.value === '2000');
      page.type(gross, '2500');
      await page.settle();
      await storage.flush();
      await page.settle();
      assert.equal(storage.getState().workplaces[0].profile.gross, 2500, 'in the state');
      assert.equal(disk(page).workplaces[0].profile.gross, 2500, 'on disk');
      assert.match(page.text(), /All changes saved on this device/);
      await bothKept(page, withData);
    } finally {
      await page.close();
    }
  });

  test('two copies: night edit in A after B saved' + when, async () => {
    const page = await boot({ seed: seed() });
    try {
      page.tab('periods');
      page.click(page.$$('button').find((b) => /^Edit night/.test(b.getAttribute('aria-label') || '')));
      await otherWindowSaves(page, withData);
      const form = page.must(
        page.$$('form').find((f) => /Save changes/.test(f.textContent)),
        'night editor still open',
      );
      const total = page.$$('input', form).find((i) => i.value === '300');
      page.type(total, '345');
      page.click(page.button('Save changes', form));
      await page.settle();
      assert.equal(storage.getState().nights.find((n) => n.id === 'n0').total, 345, 'in the state');
      await bothKept(page, withData);
      assert.equal(disk(page).nights.find((n) => n.id === 'n0').total, 345, 'on disk');
    } finally {
      await page.close();
    }
  });

  test('two copies: Budget adds (bill, goal, category, other income) in A after B saved' + when, async () => {
    const page = await boot({ url: DEV, seed: seed() });
    try {
      page.tab('budget');
      await otherWindowSaves(page, withData);
      // category
      page.type(key(page, 'ef-category-new-name'), 'Groceries2');
      page.type(key(page, 'ef-category-new-monthly'), '100');
      page.click(page.button('Add category'));
      await otherWindowSaves(page, withData);
      // other income
      const inc = page.$('form[aria-label="Add other income"]');
      page.type(key(page, 'ef-income-new-name'), 'DoorDash');
      page.type(key(page, 'ef-income-new-amount'), '150');
      page.type(key(page, 'ef-income-new-date'), todayISO());
      page.click(page.button('Add other income', inc));
      await otherWindowSaves(page, withData);
      // goal
      const gf = page.$('form[aria-label="Add a savings goal"]');
      page.type(key(page, 'ef-goal-new-name'), 'Trip');
      page.type(key(page, 'ef-goal-new-cost'), '500');
      page.type(key(page, 'ef-goal-new-per'), '20');
      page.click(page.button('Add goal', gf));
      await otherWindowSaves(page, withData);
      // bill (due tomorrow-ish, so no "already paid" question)
      const det = page.$$('details').find((d) => /Add a bill/.test(d.textContent));
      det.open = true;
      const f = (l) => page.$$('input').find((i) => i.labels && i.labels[0] && i.labels[0].textContent.startsWith(l));
      page.type(f('Bill name'), 'Gym');
      page.type(f('Amount'), '30');
      page.type(f('Due day'), '28');
      page.click(page.button('Add bill'));
      await page.settle();
      await bothKept(page, withData);
      for (const S of [storage.getState(), disk(page)]) {
        assert.ok(S.budget.categories.some((c) => c.name === 'Groceries2'), 'category');
        assert.ok((S.budget.income || []).some((c) => c.name === 'DoorDash'), 'income');
        assert.ok(S.budget.goals.some((c) => c.name === 'Trip'), 'goal');
        assert.ok(S.budget.bills.some((c) => c.name === 'Gym'), 'bill');
      }
    } finally {
      await page.close();
    }
  });

  test('two copies: Undo in A after B saved' + when, async () => {
    const page = await boot({ url: DEV, seed: seed() });
    try {
      page.tab('budget');
      const n = storage.getState().budget.categories.length;
      const name = storage.getState().budget.categories[0].name;
      const del = page.byLabel('Delete ' + name);
      page.click(del);
      page.click(del);
      assert.equal(storage.getState().budget.categories.length, n - 1);
      await storage.flush();
      await otherWindowSaves(page, withData);
      page.click(page.button('Undo', page.$('#toast')));
      await page.settle();
      await bothKept(page, withData);
      for (const S of [storage.getState(), disk(page)])
        assert.ok(S.budget.categories.some((c) => c.name === name), 'restored');
    } finally {
      await page.close();
    }
  });
}

test('two copies: the state object is never replaced by another window’s save', async () => {
  const page = await boot({ seed: seed() });
  try {
    const S = storage.getState();
    const w = S.workplaces[0];
    const p = w.profile;
    const nights = S.nights;
    await otherWindowSaves(page, true);
    assert.equal(storage.getState(), S);
    assert.equal(storage.getState().workplaces[0], w);
    assert.equal(storage.getState().workplaces[0].profile, p);
    assert.equal(storage.getState().nights, nights);
    assert.equal(S.settings.theme, 'dark', 'the live object holds the new data');
  } finally {
    await page.close();
  }
});

test('two copies: a half-typed Budget form survives a redraw caused by another window', async () => {
  const page = await boot({ url: DEV, seed: seed() });
  try {
    page.tab('budget');
    page.type(key(page, 'ef-category-new-name'), 'Half typed');
    await otherWindowSaves(page, true);
    assert.equal(key(page, 'ef-category-new-name').value, 'Half typed');
    page.type(key(page, 'ef-category-new-monthly'), '40');
    page.click(page.button('Add category'));
    assert.ok(storage.getState().budget.categories.some((c) => c.name === 'Half typed'));
  } finally {
    await page.close();
  }
});
