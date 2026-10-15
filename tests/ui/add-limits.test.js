// Setup stops offering "+ Add" at what loading keeps: 30 pay types (retired ones count), 20 people tipped out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { migrate } from '../../app/js/storage.js';

const withPay = (count, retired = 0) =>
  realState((S) => {
    const w = S.workplaces[0];
    w.setupDone = true;
    w.profile.tipout.on = false;
    w.profile.payTypes = [{ id: 'p1', k: 'bartender', name: 'Bartender', unit: 'hr', rate: 12, usual: 0 }];
    for (let i = 2; i <= count; i++) {
      const t = { id: 'p' + i, k: 'otherjob', name: 'Job ' + i, unit: 'hr', rate: 10, usual: 0 };
      if (i <= retired + 1) t.retired = 1;
      w.profile.payTypes.push(t);
    }
  });

test('30 pay types (retired ones counted): both Add buttons are off with a plain line; 29 still allows one', async () => {
  const page = await boot({ seed: withPay(30, 5) });
  try {
    page.openSetup();
    assert.equal(page.$('#pt-add').disabled, true);
    assert.equal(page.$('#op-add').disabled, true);
    assert.match(page.$('#pt-limit').textContent, /^You can have up to 30 jobs and other pay types\.$/);
    assert.equal(page.$('#pt-limit').hidden, false);
  } finally {
    await page.close();
  }
  const p2 = await boot({ seed: withPay(29, 3) });
  try {
    p2.openSetup();
    assert.equal(p2.$('#pt-add').disabled, false);
    assert.equal(p2.$('#pt-limit').hidden, true);
    p2.click(p2.$('#pt-add'));
    assert.equal(p2.$('#pt-add').disabled, true, 'the 30th was added');
    p2.click(p2.$('#pt-add'));
    assert.equal(
      p2.state().workplaces[0].profile.payTypes.length,
      29,
      'nothing saved beyond the draft either',
    );
  } finally {
    await p2.close();
  }
});

test('30 pay types survive a reload', () => {
  const S = withPay(30, 5);
  const M = migrate(JSON.parse(JSON.stringify(S)));
  assert.equal(M.workplaces[0].profile.payTypes.length, 30);
});

test('20 people tipped out: the Add button is off with a plain line', async () => {
  const seed = realState((S) => {
    const w = S.workplaces[0];
    w.setupDone = true;
    w.profile.tipout.on = true;
    w.profile.tipouts = Array.from({ length: 20 }, (_, i) => ({
      id: 't' + (i + 1),
      k: 'other',
      who: 'Person ' + (i + 1),
      mode: 'pctTips',
      pct: 1,
      from: 'cash',
    }));
  });
  const page = await boot({ seed });
  try {
    page.openSetup();
    assert.equal(page.$$('#to-rows .repeat-row').length, 20);
    assert.equal(page.$('#to-add').disabled, true);
    assert.equal(page.$('#to-limit').textContent, 'You can have up to 20 people.');
  } finally {
    await page.close();
  }
});
