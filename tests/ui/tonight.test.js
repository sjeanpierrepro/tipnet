import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';

const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
  });
const totalInput = (page) => page.must(page.$('[data-focus-key="night-total"]'), 'total field');
const cashInput = (page) => page.must(page.$('[data-focus-key="night-cash"]'), 'cash field');
const submit = (page) => page.click(page.$('form button[type=submit]'));
const hoursInput = (page) => page.must(page.$('[data-focus-key="night-pay-p1"]'), 'hours field');

for (const [name, cash, msg] of [
  ['negative', '-5', /can.t be a negative/],
  [
    'more than the tips in the total',
    '40',
    /more than the tips in what you made tonight \(the total minus \$72\.00 of hourly pay\)/,
  ],
]) {
  test('tonight: cash ' + name + ' shows a message and the cash is not saved', async () => {
    const page = await boot({ seed: seed() });
    try {
      page.type(totalInput(page), '100');
      page.type(hoursInput(page), '6');
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
    page.type(hoursInput(page), '6');
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
  const id = page.state().workplaces[0].profile.payTypes[0].id;
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
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.tipout.on = false;
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
    assert.equal(n[0].pay[page.state().workplaces[0].profile.payTypes[0].id], 7.5);
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
    page.type(hoursInput(page), '6');
    submit(page);
    assert.equal(page.doc.activeElement, totalInput(page));
    assert.equal(hoursInput(page).value, '', 'hours are cleared after saving, never remembered');
    const input = totalInput(page);
    page.type(input, '120');
    page.type(hoursInput(page), '6');
    page.key(input, 'Enter');
    assert.equal(page.state().nights.length, 1, 'same date asks first, so nothing new saved');
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'dup-add');
  } finally {
    await page.close();
  }
});

test('tonight: same date asks; Add, Replace and Separate each work', async () => {
  for (const [btn, expect] of [
    ['dup-add', { n: 1, total: 250, cash: 30, hours: 10 }],
    ['dup-replace', { n: 1, total: 150, cash: 10, hours: 4 }],
    ['dup-separate', { n: 2, total: 100, cash: 20, hours: 6 }],
  ]) {
    const page = await boot({ seed: seed() });
    try {
      page.type(totalInput(page), '100');
      page.type(cashInput(page), '20');
      page.type(hoursInput(page), '6');
      submit(page);
      page.type(totalInput(page), '150');
      page.type(cashInput(page), '10');
      page.type(hoursInput(page), '4');
      submit(page);
      assert.equal(page.state().nights.length, 1, 'not saved until you choose');
      assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'dup-add', 'default focus');
      page.click(page.$('[data-focus-key="' + btn + '"]'));
      const n = page.state().nights;
      assert.equal(n.length, expect.n);
      assert.equal(n[0].total, expect.total);
      assert.equal(n[0].cash, expect.cash);
      assert.equal(n[0].pay.p1, expect.hours);
      assert.equal(page.doc.activeElement, totalInput(page));
    } finally {
      await page.close();
    }
  }
});

test('tonight: strip leaves out example nights once the profile is real', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
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

test('tonight: has a visible h1 "Tonight" like the other tabs, and section headings', async () => {
  const page = await boot({ seed: seed() });
  try {
    const h1 = page.$('h1', page.app);
    assert.equal(h1.textContent, 'Tonight');
    assert.ok(!h1.classList.contains('sr-only'));
    assert.ok(page.doc.querySelectorAll('h2').length >= 1);
  } finally {
    await page.close();
  }
});

test('tonight: at 1 a.m. on a pay period’s first day, the pay period summary is still the one the night belongs to', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 5, 1, 0) }); // Oct 5, 1 a.m.: a new period starts Oct 5
  try {
    const page = await boot({
      seed: realState((S) => {
        S.workplaces[0].setupDone = true;
        Object.assign(S.workplaces[0].profile, {
          freq: 14,
          periodStart: '2026-09-21',
          periodEnd: '2026-10-04',
        });
        S.nights = [{ id: 'a', date: '2026-10-04', total: 300, cash: 100, pay: { p1: 6 }, barback: false }];
      }),
    });
    try {
      assert.equal(page.$('[data-focus-key="night-date"]').value, '2026-10-04', 'tonight is still Oct 4');
      const t = page.text();
      assert.match(t, /Check so far this pay period \(1 night\): \$/);
      assert.doesNotMatch(t, /No nights logged yet this period/);
    } finally {
      await page.close();
    }
  } finally {
    mock.timers.reset();
  }
});

test('tonight: hints are linked to their fields (aria-describedby), together with the error when there is one', async () => {
  const page = await boot({ seed: seed() });
  try {
    const ids = (n) => (n.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const texts = (n) => ids(n).map((id) => page.must(page.doc.getElementById(id), '#' + id).textContent);
    const tot = totalInput(page);
    assert.deepEqual(ids(tot).length, 1);
    assert.match(texts(tot)[0], /Cash \+ card tips/);
    const hours = hoursInput(page);
    assert.ok(ids(hours).length >= 1, 'hours field has its rate hint');
    assert.ok(
      ids(hours).every((id) => page.doc.getElementById(id).classList.contains('hint')),
      'only the hint while there is no error',
    );
    submit(page); // nothing typed: the total shows an error
    assert.equal(tot.getAttribute('aria-invalid'), 'true');
    assert.equal(ids(tot).length, 2, 'error and hint');
    assert.ok(page.doc.getElementById(ids(tot)[0]).classList.contains('field-error'));
    assert.match(texts(tot)[1], /Cash \+ card tips/);
    page.type(cashInput(page), '20');
    const off = page.must(page.$('[data-focus-key="night-cashoff"]'), 'cash checkbox');
    assert.match(texts(off)[0], /Tick this if no tax was taken out/);
  } finally {
    await page.close();
  }
});

test('tonight: the result card says estimates use one tax rate, and Check my accuracy keeps it close', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(totalInput(page), '200');
    page.type(hoursInput(page), '6');
    const line = page.must(page.$('#result-one-rate'), 'one-rate line');
    assert.equal(
      line.textContent,
      'Estimates use one tax rate from your paystub; very big or small weeks can be withheld differently. “Check my accuracy” after payday keeps it close.',
    );
  } finally {
    await page.close();
  }
});

test('tonight: clearing the Date field falls back to the Late-nights business date, not the calendar date', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 30, 3, 15) }); // Sep 30, 3:15 a.m.: still Sep 29's night
  try {
    const page = await boot({ seed: seed() });
    try {
      const date = page.must(page.$('[data-focus-key="night-date"]'), 'date field');
      page.type(date, '2026-09-20');
      page.type(date, ''); // cleared
      page.type(totalInput(page), '100');
      page.type(hoursInput(page), '6');
      submit(page);
      await page.settle();
      assert.equal(page.state().nights.length, 1);
      assert.equal(page.state().nights[0].date, '2026-09-29');
    } finally {
      await page.close();
    }
  } finally {
    mock.timers.reset();
  }
});
