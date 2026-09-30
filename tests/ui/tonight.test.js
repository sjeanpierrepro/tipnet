import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';

const seed = () =>
  realState((S) => {
    S.settings.setupDone = true;
  });
const totalInput = (page) => page.must(page.$('[data-focus-key="night-total"]'), 'total field');
const cashInput = (page) => page.must(page.$('[data-focus-key="night-cash"]'), 'cash field');
const submit = (page) => page.click(page.$('form button[type=submit]'));

for (const [name, cash, msg] of [
  ['negative', '-5', /can.t be a negative/],
  ['more than the total', '200', /more than what you made/],
]) {
  test('tonight: cash ' + name + ' shows a message and the cash is not saved', async () => {
    const page = await boot({ seed: seed() });
    try {
      page.type(totalInput(page), '100');
      page.type(cashInput(page), cash);
      assert.match(page.text(), msg);
      submit(page);
      const n = page.state().nights;
      assert.equal(n.length, 1);
      assert.equal(n[0].total, 100);
      assert.equal(n[0].cash, null, 'invalid cash is not stored');
      assert.match(page.text(), /The cash amount was not saved/);
    } finally {
      await page.close();
    }
  });
}

test('tonight: an empty total is refused and not saved', async () => {
  const page = await boot({ seed: seed() });
  try {
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.match(page.text(), /Enter what you made tonight first/);
  } finally {
    await page.close();
  }
});

test('tonight: Enter in the total field saves the night', async () => {
  const page = await boot({ seed: seed() });
  try {
    const input = totalInput(page);
    page.type(input, '250');
    page.key(input, 'Enter'); // happy-dom performs the browser's implicit form submission
    assert.equal(page.state().nights.length, 1);
    assert.equal(page.state().nights[0].total, 250);
  } finally {
    await page.close();
  }
});

test('tonight: before 6 a.m. the default date is yesterday (fake clock), after 6 it is today', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 30, 3, 15) }); // Sep 30, 3:15 a.m. local time
  try {
    const page = await boot({ seed: seed() });
    try {
      assert.equal(page.$('[data-focus-key="night-date"]').value, '2026-09-29');
    } finally {
      await page.close();
    }
    mock.timers.setTime(new Date(2026, 8, 30, 6, 0).getTime());
    const page2 = await boot({ seed: seed() });
    try {
      assert.equal(page2.$('[data-focus-key="night-date"]').value, '2026-09-30');
    } finally {
      await page2.close();
    }
  } finally {
    mock.timers.reset();
  }
  // the pure helper, including a month boundary and the cutoff switched off
  assert.equal(businessDate(new Date(2026, 9, 1, 5, 59), 6), '2026-09-30');
  assert.equal(businessDate(new Date(2026, 9, 1, 6, 0), 6), '2026-10-01');
  assert.equal(businessDate(new Date(2026, 9, 1, 2, 0), 0), '2026-10-01');
});
