// Establishment limits: 3 in the free app, 5 with TipNet Budget. Only adding is blocked; nothing already there is removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState, toCode } from './harness.js';
import { exampleProfile, todayISO } from '../../app/js/math.js';
import { decodeBackup, migrate, canAddWorkplace, workplaceLimit } from '../../app/js/storage.js';

const today = todayISO();
/** A set-up state with `count` establishments (Bar 1, Bar 2, ...). */
const withPlaces = (count, mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].name = 'Bar 1';
    for (let i = 2; i <= count; i++)
      S.workplaces.push({
        id: 'w' + i,
        name: 'Bar ' + i,
        profile: exampleProfile(today),
        calib: [],
        setupDone: true,
      });
    if (mutate) mutate(S);
  });
const rows = (page) => page.$$('button.fold-head[id^="wp-row-"]', page.app);
const selected = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;

test('free app: a 3rd establishment can be added, then the button is disabled with a plain line', async () => {
  const page = await boot({ seed: withPlaces(2) });
  try {
    page.tab('setup');
    const add = page.$('#wp-add');
    assert.equal(add.disabled, false);
    page.click(add);
    page.type(page.$('#wp-new-name'), 'Third Place');
    page.click(page.button('Start setup'));
    assert.equal(page.state().workplaces.length, 3);
    // finish later: Skip its guided setup, back on the full page
    page.click(page.button('Skip guided setup'));
    const at = page.must(page.$('#wp-add'), 'add button');
    assert.equal(at.disabled, true);
    assert.equal(at.getAttribute('aria-describedby'), 'wp-limit');
    assert.match(
      page.$('#wp-limit').textContent,
      /^You can have up to 3 establishments in the free app\. TipNet Budget \(coming soon\) will allow up to 5\./,
    );
    assert.doesNotMatch(page.$('#wp-limit').textContent, /Unlock/, 'payments off: nothing to buy yet');
    page.click(page.button('See what’s inside', page.$('#wp-limit')));
    assert.equal(selected(page), 'budget', '"See what’s inside" opens the Budget preview');
  } finally {
    await page.close();
  }
});

test('payments on: the limit line asks to unlock TipNet Budget', async () => {
  const page = await boot({ seed: withPlaces(3), payments: true });
  try {
    page.tab('setup');
    assert.match(
      page.$('#wp-limit').textContent,
      /^You can have up to 3 establishments\. Unlock TipNet Budget to add up to 5\./,
    );
    page.click(page.button('See what’s inside', page.$('#wp-limit')));
    assert.equal(selected(page), 'budget');
  } finally {
    await page.close();
  }
});

test('Budget unlocked (?unlock=dev on localhost): up to 5', async () => {
  const page = await boot({ url: 'http://localhost/?unlock=dev', seed: withPlaces(4) });
  try {
    page.tab('setup');
    assert.equal(page.$('#wp-add').disabled, false, '4 of 5');
    page.click(page.$('#wp-add'));
    page.type(page.$('#wp-new-name'), 'Fifth');
    page.click(page.button('Start setup'));
    assert.equal(page.state().workplaces.length, 5);
    page.click(page.button('Skip guided setup'));
    assert.equal(page.$('#wp-add').disabled, true);
    assert.equal(page.$('#wp-limit').textContent, 'You can have up to 5 establishments.');
    assert.equal(page.$('#wp-limit-see'), null);
  } finally {
    await page.close();
  }
});

test('Budget ended (or an older version): 5 establishments stay, all usable; only adding is blocked', async () => {
  const page = await boot({ seed: withPlaces(5) });
  try {
    assert.equal(page.$$('#tonight-picker [role=radio]', page.app).length, 5);
    page.tab('setup');
    assert.equal(rows(page).length, 5);
    assert.equal(page.$('#wp-add').disabled, true);
    assert.match(page.$('#wp-limit').textContent, /up to 3 establishments/);
    page.openSetup('Bar 5'); // still opens and edits
    assert.ok(page.$('#draft-save'));
    assert.equal(page.state().workplaces.length, 5);
  } finally {
    await page.close();
  }
});

test('a restored backup with 7 establishments keeps all 7; adding is blocked', async () => {
  const seven = withPlaces(7);
  const restored = decodeBackup(toCode(seven));
  assert.equal(restored.workplaces.length, 7);
  assert.equal(migrate(seven).workplaces.length, 7);
  assert.equal(canAddWorkplace(restored, false), false);
  assert.equal(canAddWorkplace(restored, true), false);
  assert.equal(workplaceLimit(false), 3);
  assert.equal(workplaceLimit(true), 5);
  const page = await boot({ seed: withPlaces(1) });
  try {
    page.tab('setup');
    page.click(page.button('Backups'));
    page.type(page.$('#bk-code'), toCode(seven));
    page.click(page.button('Restore from code'));
    const again = page.byText('button', 'Tap again');
    if (again) page.click(again);
    await page.settle();
    page.tab('setup');
    assert.equal(page.state().workplaces.length, 7);
    assert.equal(rows(page).length, 7);
    assert.equal(page.$('#wp-add').disabled, true);
  } finally {
    await page.close();
  }
});
