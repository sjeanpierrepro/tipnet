import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, quiet, toCode, realState } from './harness.js';
import { encodeBackup, seedState } from '../../app/js/storage.js';
import { bus } from '../../app/js/ui/common.js';
import { isUnlocked } from '../../app/js/billing.js';

const future = new Date(Date.now() + 5 * 864e5).toISOString();
const forged = () => {
  const S = seedState();
  S.settings.entitlement = {
    status: 'active',
    instanceId: null,
    validatedAt: future,
    plan: 'monthly',
    key: 'FORGED-KEY',
  };
  S.nightsExample = false;
  S.nights = [];
  return toCode(S);
};
const restoreVia = (page, code) => {
  page.tab('setup');
  const skip = page.byText('button', 'Skip guided setup');
  if (skip) page.click(skip);
  page.type(page.must(page.$('#bk-code'), '#bk-code'), code);
  page.click(page.button('Restore from code'));
};

test('restore: a hand-made code with an entitlement does not unlock Budget (payments off)', async () => {
  const page = await boot();
  try {
    assert.equal(page.tabHidden('budget'), true);
    restoreVia(page, forged());
    assert.equal(page.state().settings.entitlement, undefined);
    assert.equal(page.tabHidden('budget'), true);
    assert.equal(isUnlocked(page.state().settings.entitlement), false);
  } finally {
    await page.close();
  }
});

test('restore: a hand-made code with an entitlement stays locked when payments are on', async () => {
  const page = await boot({ payments: true });
  try {
    assert.equal(page.tabHidden('budget'), false, 'Budget tab is visible (locked) when payments are on');
    restoreVia(page, forged());
    assert.equal(page.state().settings.entitlement, undefined);
    page.tab('budget');
    assert.match(page.text(), /Unlock Budget/);
    assert.equal(page.$('#budget-balance'), null, 'no unlocked budget controls');
  } finally {
    await page.close();
  }
});

test('restore: a garbage but decodable code restores to a working app', async () => {
  const page = await boot({ payments: true });
  try {
    restoreVia(page, toCode({ profile: { deductions: {} }, nights: [null, { date: 'x' }] }));
    assert.equal(page.state().nights.length, 0);
    for (const t of ['tonight', 'periods', 'budget', 'setup']) {
      page.tab(t);
      assert.doesNotMatch(page.text(), /Something went wrong/, t);
      assert.ok(page.app.firstChild, t + ' rendered');
    }
  } finally {
    await page.close();
  }
});

/** Force a render error by poisoning the in-memory state (nights is not a list). */
const poison = (page) => {
  page.state().nights = null;
  bus.rerender();
};

test('error screen: shows, restores from a code, and erases with two taps', async () => {
  const page = await boot({ seed: realState((S) => (S.workplaces[0].setupDone = true)) }); // opens on Tonight
  try {
    await quiet(async () => poison(page));
    assert.match(page.text(), /Something went wrong/);
    const box = page.$('#err-code');

    // a bad code says so and changes nothing
    page.type(box, 'not a code');
    page.click(page.button('Restore from a backup code'));
    assert.match(page.text(), /That code did not work/);

    // a good code restores
    const good = realState((S) => {
      S.nights = [{ id: 1, date: '2026-01-05', total: 300, cash: 50, pay: { p1: 6 }, barback: true }];
    });
    page.type(box, encodeBackup(good));
    page.click(page.button('Restore from a backup code'));
    assert.doesNotMatch(page.text(), /Something went wrong/);
    assert.equal(page.state().nights.length, 1);
    assert.ok(page.$('.result'), 'Tonight renders again');

    // erase needs two taps
    await quiet(async () => poison(page));
    const erase = page.button('Erase everything');
    page.click(erase);
    assert.match(page.text(), /Something went wrong/, 'one tap does not erase');
    assert.match(erase.textContent, /Tap again/);
    page.click(erase);
    assert.doesNotMatch(page.text(), /Something went wrong/);
    assert.equal(page.state().nights.length, 0);
    assert.equal(
      page.$('#tabs [aria-selected=true]').dataset.tab,
      'setup',
      'erased: back to the first-launch Setup',
    );
    assert.match(page.text(), /Set up with one recent paystub/);
  } finally {
    await page.close();
  }
});

test('restore: two taps whenever something is worth keeping (setup, budget items, nights), and Undo brings it back', async () => {
  const backup = realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].name = 'From The Backup';
  });
  // finished setup, no nights and no budget yet: still two taps
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].name = 'Mine Here';
    }),
  });
  try {
    page.tab('setup');
    page.type(page.$('#bk-code'), encodeBackup(backup));
    const btn = page.button('Restore from code');
    page.click(btn);
    assert.equal(page.state().workplaces[0].name, 'Mine Here', 'one tap only arms');
    assert.match(btn.textContent, /Tap again to replace what is here/);
    page.click(btn);
    assert.equal(page.state().workplaces[0].name, 'From The Backup', 'second tap restores');
    const undo = [...page.doc.querySelectorAll('#toast button')].find((b) => /undo/i.test(b.textContent));
    assert.ok(undo, 'Undo offered after a restore');
    page.click(undo);
    assert.equal(page.state().workplaces[0].name, 'Mine Here', 'Undo puts the earlier data back');
    assert.match(page.doc.getElementById('toast').textContent, /Restore undone/);
  } finally {
    await page.close();
  }
});

test('restore: budget items alone also need two taps; a fresh device restores with one', async () => {
  const { worthKeeping } = await import('../../app/js/ui/backup.js');
  const fresh = seedState();
  assert.equal(worthKeeping(fresh), false, 'first launch: nothing to lose');
  const withBill = seedState();
  withBill.budget.bills.push({ id: 'b1', name: 'Rent', amount: 1000, dueDay: 1 });
  assert.equal(worthKeeping(withBill), true);
  const withBalance = seedState();
  withBalance.budget.balance = { amount: 50, asOf: '2026-10-01T12:00:00' };
  assert.equal(worthKeeping(withBalance), true);
  const page = await boot();
  try {
    page.tab('setup');
    page.click(page.byLabel('Moving from another phone? Restore a backup code'));
    page.type(page.$('#bk-code'), encodeBackup(realState((S) => (S.workplaces[0].setupDone = true))));
    page.click(page.button('Restore from code'));
    assert.equal(page.$('#tabs [aria-selected=true]').dataset.tab, 'tonight', 'one tap on a fresh device');
  } finally {
    await page.close();
  }
});

test('restore: a code from a newer TipNet is refused with a plain message, and nothing here changes', async () => {
  const page = await boot({ seed: realState((S) => (S.workplaces[0].setupDone = true)) });
  try {
    const S = realState();
    S.nights = [
      { id: 'z', date: '2026-09-22', total: 250, tips: 200, cash: 50, pay: { p1: 4 }, barback: false },
    ];
    S.schemaVersion = 99;
    page.tab('setup');
    const before = JSON.stringify(page.state());
    page.type(page.must(page.$('#bk-code'), '#bk-code'), toCode(S));
    // refused on the FIRST tap (the before check of arm): no "Tap again to replace what is here" for a code that cannot restore
    const btn = page.button('Restore from code');
    page.click(btn);
    assert.match(page.text(), /This backup was made by a newer version of TipNet\./);
    assert.equal(btn.textContent, 'Restore from code', 'not armed');
    assert.equal(btn.hasAttribute('data-armed'), false);
    assert.equal(JSON.stringify(page.state()), before);
    // a code that isn't TipNet data, and one that can't be read: the same, each with its own message
    page.type(page.$('#bk-code'), toCode({ workplaces: [], nights: [] }));
    page.click(btn);
    assert.match(page.text(), /This isn’t a TipNet backup\. Nothing was changed\./);
    assert.equal(btn.textContent, 'Restore from code');
    page.type(page.$('#bk-code'), 'abc');
    page.click(btn);
    assert.match(page.text(), /That code didn’t work/);
    assert.equal(btn.textContent, 'Restore from code');
    assert.equal(JSON.stringify(page.state()), before);
    // a good code still asks twice
    page.type(page.$('#bk-code'), toCode(realState()));
    page.click(btn);
    assert.equal(btn.textContent, 'Tap again to replace what is here');
  } finally {
    await page.close();
  }
});

test('restore: a code or file that is not TipNet data is refused with a plain message, and nothing here changes', async () => {
  const page = await boot({ seed: realState((S) => (S.workplaces[0].setupDone = true)) });
  try {
    page.tab('setup');
    const before = JSON.stringify(page.state());
    for (const d of [
      { workplaces: [], nights: [] },
      { workplaces: [{ id: 'w1' }], nights: [] },
      { profile: 1, nights: [] },
    ]) {
      page.type(page.must(page.$('#bk-code'), '#bk-code'), toCode(d));
      const btn = page.must(
        page.$$('button').find((b) => /Restore from code|Tap again/.test(b.textContent)),
        'restore',
      );
      page.click(btn);
      if (/Tap again/.test(btn.textContent)) page.click(btn);
      assert.match(page.text(), /This isn’t a TipNet backup\. Nothing was changed\./, JSON.stringify(d));
      assert.equal(JSON.stringify(page.state()), before);
      // the same as a file
      const input = page.must(page.$('#bk-file'), 'file input');
      const text = JSON.stringify(d);
      Object.defineProperty(input, 'files', {
        configurable: true,
        value: [{ size: text.length, text: async () => text }],
      });
      input.dispatchEvent(new page.win.Event('change'));
      await page.settle();
      assert.match(page.text(), /This isn’t a TipNet backup\. Nothing was changed\./);
      assert.equal(JSON.stringify(page.state()), before);
    }
  } finally {
    await page.close();
  }
});
