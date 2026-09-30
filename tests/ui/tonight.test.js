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

const payInput = (page) => {
  const id = page.state().profile.payTypes[0].id;
  return page.must(page.$('[data-focus-key="night-pay-' + id + '"]'), 'hours field');
};
const labelTexts = (page) => Array.from(page.doc.querySelectorAll('label')).map((l) => l.textContent);

test('tonight: cash label says "collected" when the barback is paid from cash before tip-out', async () => {
  const page = await boot({ seed: seed() });
  try {
    assert.ok(labelTexts(page).some((t) => /Cash tips collected \(before paying the barback\)/.test(t)));
    assert.match(
      page.text(),
      /Count all the cash you made tonight, then TipNet takes the barback’s cash out/,
    );
  } finally {
    await page.close();
  }
});

test('tonight: cash label is "taking home" when tip-out is off', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.settings.setupDone = true;
      S.profile.tipout.on = false;
    }),
  });
  try {
    assert.ok(labelTexts(page).some((t) => /Cash you’re taking home/.test(t)));
    assert.ok(!labelTexts(page).some((t) => /collected/.test(t)));
  } finally {
    await page.close();
  }
});

test('tonight: $585 / 8h / 15% from cash / $210 cash shows cash you keep and on your check', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '585');
    page.type(payInput(page), '8');
    page.type(cashInput(page), '210');
    const t = page.text();
    assert.match(t, /Cash you keep\s*\$136\.65/);
    assert.match(t, /On your check\s*\$283\.81/);
    assert.ok(!/Cash in hand/.test(t));
  } finally {
    await page.close();
  }
});

test('tonight: hours typed as 7:30 are saved as 7.5', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '300');
    page.type(payInput(page), '7:30');
    submit(page);
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].pay[page.state().profile.payTypes[0].id], 7.5);
  } finally {
    await page.close();
  }
});

test('tonight: more than 24 hours is refused with a message', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '300');
    page.type(payInput(page), '730');
    assert.match(page.text(), /more than 24 hours/);
    submit(page);
    assert.equal(page.state().nights.length, 0);
  } finally {
    await page.close();
  }
});

test('tonight: hourly pay above the total warns but still saves', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '60');
    page.type(payInput(page), '8');
    assert.match(
      page.text(),
      /Your hourly pay for 8 hours is \$[\d.,]+, more than the \$60\.00 you entered\. Did you include your hourly pay\?/,
    );
    submit(page);
    assert.equal(page.state().nights.length, 1);
  } finally {
    await page.close();
  }
});

test('tonight: after saving, focus moves to the total field (click and Enter)', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '100');
    submit(page);
    assert.equal(page.doc.activeElement, totalInput(page));
    const input = totalInput(page);
    page.type(input, '120');
    page.key(input, 'Enter');
    assert.equal(page.state().nights.length, 1, 'same date asks first, so nothing new saved');
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'dup-add');
  } finally {
    await page.close();
  }
});

test('tonight: same date asks; Add, Replace and Separate each work', async () => {
  for (const [btn, expect] of [
    ['dup-add', { n: 1, total: 250, cash: 30 }],
    ['dup-replace', { n: 1, total: 150, cash: 10 }],
    ['dup-separate', { n: 2, total: 100, cash: 20 }],
  ]) {
    const page = await boot({ seed: seed() });
    try {
      page.type(totalInput(page), '100');
      page.type(cashInput(page), '20');
      submit(page);
      page.type(totalInput(page), '150');
      page.type(cashInput(page), '10');
      submit(page);
      assert.equal(page.state().nights.length, 1, 'not saved until you choose');
      assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'dup-add', 'default focus');
      page.click(page.$('[data-focus-key="' + btn + '"]'));
      const n = page.state().nights;
      assert.equal(n.length, expect.n);
      assert.equal(n[0].total, expect.total);
      assert.equal(n[0].cash, expect.cash);
      assert.equal(page.doc.activeElement, totalInput(page));
    } finally {
      await page.close();
    }
  }
});

test('tonight: strip leaves out example nights once the profile is real', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.settings.setupDone = true;
      S.nightsExample = true;
      S.nights = [
        { id: 1, date: businessDate(new Date(), 0), total: 500, cash: 100, pay: {}, barback: true },
      ];
    }),
  });
  try {
    assert.match(page.text(), /No nights logged yet this period/);
  } finally {
    await page.close();
  }
});

test('tonight: has headings', async () => {
  const page = await boot({ seed: seed() });
  try {
    assert.ok(page.doc.querySelectorAll('h2').length >= 2);
  } finally {
    await page.close();
  }
});
