import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';

const seed = () =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
  });
const ccInput = (page) => page.must(page.$('[data-focus-key="night-cc"]'), 'CC tips field');
const cashInput = (page) => page.must(page.$('[data-focus-key="night-cash"]'), 'cash field');
const submit = (page) => page.click(page.$('form button[type=submit]'));
const hoursInput = (page) => page.must(page.$('[data-focus-key="night-pay-p1"]'), 'hours field');

for (const [box, what] of [
  [ccInput, 'CC tips'],
  [cashInput, 'Cash tips'],
]) {
  test('tonight: ' + what + ' below 0 shows a message, and the night is not saved until it is fixed', async () => {
    const page = await boot({ seed: seed() });
    try {
      page.type(ccInput(page), '50');
      page.type(cashInput(page), '50');
      page.type(hoursInput(page), '6');
      page.type(box(page), '-5');
      assert.match(page.text(), new RegExp(what + ' can.t be a negative number\\.'));
      assert.match(page.$('.result').textContent, /Fix the number marked above/);
      submit(page);
      assert.equal(page.state().nights.length, 0);
      assert.equal(page.doc.activeElement, box(page));
      page.type(box(page), '5');
      submit(page);
      const n = page.state().nights;
      assert.equal(n.length, 1);
      assert.equal(n[0].tips, 55);
      assert.equal(n[0].total, 127, '$55 tips + 6 hours at $12');
    } finally {
      await page.close();
    }
  });
}

test('tonight: nothing typed is refused and not saved', async () => {
  const page = await boot({ seed: seed() });
  try {
    submit(page);
    assert.equal(page.state().nights.length, 0);
    assert.match(page.text(), /Enter your tips or your hours first\./);
    assert.equal(page.doc.activeElement, ccInput(page));
  } finally {
    await page.close();
  }
});

test('tonight: Enter in the CC tips field saves the night; blank Cash tips is $0', async () => {
  const page = await boot({ seed: seed() });
  try {
    const input = ccInput(page);
    page.type(input, '178');
    page.type(hoursInput(page), '6');
    page.key(input, 'Enter'); // happy-dom performs the browser's implicit form submission
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].tips, 178);
    assert.equal(n[0].cash, 0);
    assert.equal(n[0].total, 250, 'the tips + 6 hours at $12');
  } finally {
    await page.close();
  }
});

test('tonight: no tips with hours saves the hourly pay', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(hoursInput(page), '8');
    submit(page);
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].tips, 0);
    assert.equal(n[0].total, 96);
    assert.equal(n[0].cash, 0);
  } finally {
    await page.close();
  }
});

test('tonight: before 6 a.m. the default date is yesterday (fake clock), after 6 it is today', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 30, 3, 15) }); // Sep 30, 3:15 a.m. local time
  try {
    const page = await boot({ seed: seed(), time: null });
    try {
      assert.equal(page.$('[data-focus-key="night-date"]').value, '2026-09-29');
    } finally {
      await page.close();
    }
    mock.timers.setTime(new Date(2026, 8, 30, 6, 0).getTime());
    const page2 = await boot({ seed: seed(), time: null });
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

test('tonight: two boxes, CC tips and Cash tips; the cash hint says the barback paid from cash comes out of it', async () => {
  const page = await boot({ seed: seed() });
  try {
    assert.ok(labelTexts(page).includes('CC tips'));
    assert.ok(labelTexts(page).includes('Cash tips'));
    assert.match(page.text(), /Credit card tips, before tip-outs\./);
    assert.match(
      page.text(),
      /All your cash tips, before paying the barback\. TipNet takes the barback’s cash out\./,
    );
    assert.match(page.text(), /Tips only: TipNet adds the pay for the jobs below\. A blank box counts as \$0\./);
  } finally {
    await page.close();
  }
});

test('tonight: with tip-outs off the cash hint is "taking home"', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.tipout.on = false;
    }),
  });
  try {
    assert.match(page.text(), /The cash tips you’re taking home\./);
    assert.match(page.text(), /Your credit card tips\./);
    assert.doesNotMatch(page.text(), /before tip-outs/);
  } finally {
    await page.close();
  }
});

test('tonight: $279 CC + $210 cash / 8h / 15% from cash shows cash you keep and on your check', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(ccInput(page), '279');
    page.type(cashInput(page), '210');
    page.type(payInput(page), '8');
    const t = page.text();
    assert.match(t, /Made tonight\s*\$585\.00/);
    assert.match(t, /of which tips\s*\$489\.00/);
    assert.match(t, /Cash you keep\s*\$136\.65/);
    assert.match(t, /On your check\s*\$283\.81/);
    assert.equal(page.$('.result .hero').textContent, '$420.46');
    assert.ok(!/Cash in hand/.test(t));
    submit(page);
    const n = page.state().nights[0];
    assert.equal(n.tips, 489);
    assert.equal(n.cash, 210);
    assert.equal(n.total, 585);
  } finally {
    await page.close();
  }
});

test('tonight: hours typed as 7:30 are saved as 7.5', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(ccInput(page), '300');
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
    page.type(ccInput(page), '300');
    page.type(payInput(page), '730');
    assert.match(page.text(), /more than 24 hours/);
    submit(page);
    assert.equal(page.state().nights.length, 0);
  } finally {
    await page.close();
  }
});

test('tonight: after saving, focus moves to the CC tips field (click and Enter)', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(ccInput(page), '100');
    page.type(hoursInput(page), '6');
    submit(page);
    assert.equal(page.doc.activeElement, ccInput(page));
    assert.equal(hoursInput(page).value, '', 'hours are cleared after saving, never remembered');
    assert.equal(ccInput(page).value, '');
    assert.equal(cashInput(page).value, '');
    const input = ccInput(page);
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
    ['dup-add', { n: 1, total: 250, tips: 130, cash: 30, hours: 10 }],
    ['dup-replace', { n: 1, total: 150, tips: 102, cash: 10, hours: 4 }],
    ['dup-separate', { n: 2, total: 100, tips: 28, cash: 20, hours: 6 }],
  ]) {
    const page = await boot({ seed: seed() });
    try {
      page.type(ccInput(page), '8');
      page.type(cashInput(page), '20');
      page.type(hoursInput(page), '6');
      submit(page);
      page.type(ccInput(page), '92');
      page.type(cashInput(page), '10');
      page.type(hoursInput(page), '4');
      submit(page);
      assert.equal(page.state().nights.length, 1, 'not saved until you choose');
      assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'dup-add', 'default focus');
      assert.match(page.text(), /You already saved \$100\.00 \(tips \$28\.00\)/);
      page.click(page.$('[data-focus-key="' + btn + '"]'));
      const n = page.state().nights;
      assert.equal(n.length, expect.n);
      assert.equal(n[0].total, expect.total);
      assert.equal(n[0].tips, expect.tips);
      assert.equal(n[0].cash, expect.cash);
      assert.equal(n[0].pay.p1, expect.hours);
      assert.equal(page.doc.activeElement, ccInput(page));
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
      time: null,
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
    const cc = ccInput(page);
    assert.deepEqual(texts(cc), [
      'Credit card tips, before tip-outs.',
      'Tips only: TipNet adds the pay for the jobs below. A blank box counts as $0.',
    ]);
    assert.match(texts(cashInput(page))[0], /All your cash tips/);
    const hours = hoursInput(page);
    assert.ok(ids(hours).length >= 1, 'hours field has its rate hint');
    assert.ok(
      ids(hours).every((id) => page.doc.getElementById(id).classList.contains('hint')),
      'only the hint while there is no error',
    );
    submit(page); // nothing typed: the CC tips box shows an error
    assert.equal(cc.getAttribute('aria-invalid'), 'true');
    assert.equal(ids(cc).length, 3, 'error and hints');
    assert.ok(page.doc.getElementById(ids(cc)[0]).classList.contains('field-error'));
    assert.equal(page.doc.getElementById(ids(cc)[0]).getAttribute('role'), 'alert', 'what Save refused');
    assert.match(texts(cc)[1], /Credit card tips/);
    page.type(cashInput(page), '20');
    assert.equal(cc.getAttribute('aria-invalid'), null, 'typing clears what Save said');
    const off = page.must(page.$('[data-focus-key="night-cashoff"]'), 'cash checkbox');
    assert.match(texts(off)[0], /Tick this if no tax was taken out/);
  } finally {
    await page.close();
  }
});

test('tonight: the result card says estimates use one tax rate, and Check my accuracy keeps it close', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(ccInput(page), '128');
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
    const page = await boot({ seed: seed(), time: null });
    try {
      const date = page.must(page.$('[data-focus-key="night-date"]'), 'date field');
      page.type(date, '2026-09-20');
      page.type(date, ''); // cleared
      page.type(ccInput(page), '28');
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
