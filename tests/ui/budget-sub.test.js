import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget } from '../../app/js/budget.js';

const DEV = 'http://localhost/?unlock=dev';

test('budget: bill checkboxes and goal amount fields have names that include the item', async () => {
  const page = await boot({
    url: DEV,
    seed: realState((S) => {
      S.settings.setupDone = true;
      S.budget = exampleBudget();
    }),
  });
  try {
    page.tab('budget');
    const labels = page.$$('input[type=checkbox]').map((c) => c.getAttribute('aria-label') || '');
    assert.ok(
      labels.some((l) => /^.+ paid$/.test(l)),
      'a bill checkbox is named',
    );
    assert.ok(
      page
        .$$('input')
        .some((i) => /^Amount saved for .+ from the .+ check$/.test(i.getAttribute('aria-label') || '')),
      'a goal amount field is named',
    );
    assert.match(page.text(), /After payday \(/);
    assert.doesNotMatch(page.text(), /Next paycheck, /);
  } finally {
    await page.close();
  }
});

test('budget: an unlocked user who has not finished setup can still manage the subscription', async () => {
  const page = await boot({
    url: 'http://localhost/',
    payments: true,
    seed: realState((S) => {
      S.profileExample = true;
      S.settings.setupDone = false;
      S.settings.entitlement = {
        status: 'active',
        instanceId: 'inst-1',
        validatedAt: new Date().toISOString(),
        plan: 'monthly',
        key: 'ABCD-1234-EFGH-5678',
      };
    }),
  });
  try {
    page.tab('budget');
    const t = page.text();
    assert.match(t, /Finish setup first/);
    assert.match(t, /Subscription/);
    assert.match(t, /Manage subscription/);
    assert.ok(page.button('Remove from this device'), 'remove button reachable');
    assert.doesNotMatch(t, /ABCD-1234-EFGH-5678/, 'key is masked');
  } finally {
    await page.close();
  }
});
