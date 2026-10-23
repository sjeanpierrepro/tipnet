// The payday is required (owner request): in the guided setup and the establishment editor. A save made before this
// has none: it keeps working exactly as before (the day after the pay period ends), its Setup row says "Add your
// payday", and the field is required the next time it is edited.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { migrate } from '../../app/js/storage.js';
import { payDelayOf } from '../../app/js/budget.js';
import { periodTotals, periodRange, addDays, todayISO } from '../../app/js/math.js';

const today = todayISO();
const dateInputs = (page) => page.$$('input[type=date]', page.app);
const field = (page, label) => page.byText('.field', label, page.app).querySelector('input');

/** A set-up establishment saved before the payday was asked: no payDelay. */
const oldSave = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    delete S.workplaces[0].profile.payDelay;
    S.workplaces[0].profile.periodStart = addDays(today, -5);
    S.workplaces[0].profile.periodEnd = '';
    S.workplaces[0].profile.freq = 14;
  });

test('guided setup: step 1 needs the payday; Next explains why and goes on once it is in', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(dateInputs(page)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.type(page.$('input[placeholder="e.g. 10"]', page.app), '10');
    assert.doesNotMatch(page.text(), /Payday for this pay period\s*\(optional\)/, 'not marked optional');
    page.click(page.button('Next'));
    assert.match(page.text(), /Add your payday/);
    assert.match(page.text(), /Pay period and gross pay/, 'still on step 1');
    page.type(dateInputs(page)[2], '2026-09-20');
    page.click(page.button('Next'));
    assert.match(page.text(), /Deductions/, 'on to step 2');
  } finally {
    await page.close();
  }
});

test('guided setup: a payday more than 21 days after the period end is refused as before', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(dateInputs(page)[0], '2026-09-01');
    page.type(dateInputs(page)[2], '2026-11-01');
    assert.match(page.text(), /more than 21 days after the pay period ends/);
    page.type(dateInputs(page)[2], '2026-09-05');
    assert.match(page.text(), /can’t be before the pay period ends/);
    assert.equal(
      page.state().workplaces[0].profile.payDelay,
      undefined,
      'an out-of-range date is never stored',
    );
  } finally {
    await page.close();
  }
});

test('guided setup: a payday typed before the start date is kept, and stored once the start date is in', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(dateInputs(page)[2], '2026-09-20');
    page.type(dateInputs(page)[0], '2026-09-01');
    assert.equal(dateInputs(page)[2].value, '2026-09-20', 'the typed payday is not wiped');
    const S = page.state();
    const p = (S.settings.guidedDraft && S.settings.guidedDraft.profile) || S.workplaces[0].profile;
    assert.ok(Number.isInteger(p.payDelay), 'stored once the start date is in');
    assert.equal(addDays(periodRange(p, 0).end, p.payDelay), '2026-09-20');
  } finally {
    await page.close();
  }
});

test('old save without a payday: loads unchanged, money is the same, the row says "Add your payday"', async () => {
  const S = oldSave();
  const p = S.workplaces[0].profile;
  const loaded = migrate(JSON.parse(JSON.stringify(S)));
  assert.equal(loaded.workplaces[0].profile.payDelay, undefined, 'still absent after loading');
  assert.equal(payDelayOf(loaded.workplaces[0].profile), 1, 'the fallback: the day after the period end');
  const page = await boot({ seed: S });
  try {
    assert.equal(page.state().workplaces[0].profile.payDelay, undefined);
    const before = periodTotals(p, [], 0, today, 10);
    page.tab('setup');
    const sum = page.text(page.$('button.fold-head[id^="wp-row-"] .fold-sum'));
    assert.match(sum, /Add your payday/);
    assert.deepEqual(periodTotals(page.state().workplaces[0].profile, [], 0, today, 10), before);
  } finally {
    await page.close();
  }
});

test('editor: an old save asks for the payday on Save, and saving it stores the days', async () => {
  const page = await boot({ seed: oldSave() });
  try {
    page.openSetup();
    const delay = field(page, 'Payday for this pay period');
    assert.equal(delay.value, '');
    page.type(field(page, 'Gross pay'), '2100');
    page.change(field(page, 'Gross pay'));
    const save = page.$('#draft-save');
    assert.equal(save.disabled, true, 'Save waits for the payday');
    assert.match(page.$('#draft-reasons').textContent, /Add your payday/);
    const end = addDays(page.state().workplaces[0].profile.periodStart, 13);
    page.type(delay, addDays(end, 3));
    assert.equal(page.$('#draft-save').disabled, false);
    await page.saveSetup();
    assert.equal(page.state().workplaces[0].profile.payDelay, 3);
    assert.doesNotMatch(page.text(page.$('button.fold-head[id^="wp-row-"] .fold-sum')), /Add your payday/);
  } finally {
    await page.close();
  }
});

test('editor: clearing the payday of a saved one blocks Save again', async () => {
  const page = await boot({ seed: realState((S) => (S.workplaces[0].setupDone = true)) });
  try {
    page.openSetup();
    const delay = field(page, 'Payday for this pay period');
    assert.notEqual(delay.value, '');
    page.type(delay, '');
    assert.equal(page.$('#draft-save').disabled, true);
    assert.match(page.$('#draft-reasons').textContent, /Add your payday/);
  } finally {
    await page.close();
  }
});
