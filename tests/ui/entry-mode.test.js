// Tips-only entry ('tips') vs everything ('total'): Tonight, the night editor, duplicates and the Setup switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';
import { snapshotFor } from '../../app/js/math.js';

const tipsState = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.entryMode = 'tips';
    if (mutate) mutate(S);
  });
const totalState = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const box = (page) => page.must(page.$('[data-focus-key="night-total"]'), 'total field');
const hours = (page) => page.must(page.$('[data-focus-key="night-pay-p1"]'), 'hours field');
const cash = (page) => page.must(page.$('[data-focus-key="night-cash"]'), 'cash field');
const submit = (page) => page.click(page.$('form button[type=submit]'));
const today = () => businessDate(new Date(), 6);
/** A snapshot of the example profile with the main rate changed (a night locked at an older rate). */
const lockedAt = (S, rate) => {
  const snap = snapshotFor(S.workplaces[0].profile, 10);
  snap.pay[0].rate = rate;
  return snap;
};

test('tips mode: labels, hint and breakdown; the saved night stores tips + hourly pay and matches the preview', async () => {
  const page = await boot({ seed: tipsState() });
  try {
    assert.match(page.text(), /Tips you made tonight/);
    assert.match(page.text(), /Cash tips \+ card tips\. TipNet adds the pay for the jobs below\./);
    page.type(box(page), '350');
    page.type(hours(page), '6:30');
    page.type(cash(page), '120');
    assert.match(page.text(), /Made tonight\$428\.00/); // 350 + 6.5 x $12
    assert.match(page.text(), /of which base pay\$78\.00/);
    assert.match(page.text(), /of which tips\$350\.00/);
    const hero = page.$('.result .hero').textContent;
    submit(page);
    const [n] = page.state().nights;
    assert.equal(n.total, 428);
    assert.equal(n.pay.p1, 6.5);
    assert.equal(n.cash, 120);
    assert.ok(page.$('p.hint[role=status]').textContent.includes(hero), 'preview == saved');
    assert.equal(page.doc.activeElement, box(page), 'focus back on the tips box');
  } finally {
    await page.close();
  }
});

test('hours are typed each night: empty at first, never the usual amount, nothing remembered after saving', async () => {
  const page = await boot({ seed: tipsState() });
  try {
    assert.equal(hours(page).value, '', 'empty, although the profile still has a usual amount');
    page.type(box(page), '200');
    assert.doesNotMatch(page.text(), /Made tonight/, 'no numbers before the hours are in');
    assert.match(page.text(), /Add tonight’s hours to see your take-home\./);
    page.type(hours(page), '8');
    assert.match(page.text(), /Made tonight\$296\.00/); // 200 + 8 h x $12
    const hero = page.$('.result .hero').textContent;
    submit(page);
    assert.equal(page.state().nights[0].total, 296);
    assert.equal(page.state().nights[0].tips, 200, 'the typed tips are kept on the night');
    assert.ok(page.$('p.hint[role=status]').textContent.includes(hero), 'preview == saved');
    assert.equal(hours(page).value, '', 'the next night starts empty again');
  } finally {
    await page.close();
  }
});

for (const [mode, st] of [
  ['tips', tipsState],
  ['total', totalState],
]) {
  test(mode + ' mode: hours are required to save (0 is fine when typed)', async () => {
    const page = await boot({ seed: st() });
    try {
      page.type(box(page), '200');
      submit(page);
      assert.match(page.text(), /Enter the hours you worked tonight\./);
      assert.equal(page.state().nights.length, 0);
      assert.equal(page.doc.activeElement, hours(page), 'focus goes to the hours');
      page.type(hours(page), '0');
      submit(page);
      assert.equal(page.state().nights.length, 1);
      assert.equal(page.state().nights[0].pay.p1, 0);
    } finally {
      await page.close();
    }
  });
}

test('total mode: base pay is labelled while the hours are not entered yet', async () => {
  const page = await boot({ seed: totalState() });
  try {
    page.type(box(page), '300');
    assert.match(page.text(), /of which base pay \(hours not entered yet\)/);
    page.type(hours(page), '8');
    assert.doesNotMatch(page.text(), /hours not entered yet/);
  } finally {
    await page.close();
  }
});

test('tips mode: 0 tips with hours saves the hourly pay; blank is refused; Enter saves', async () => {
  const page = await boot({ seed: tipsState() });
  try {
    submit(page);
    assert.match(page.text(), /Enter your tips first\. Type 0 if you made none\./);
    assert.equal(page.state().nights.length, 0);
    page.type(box(page), '0');
    page.type(hours(page), '8');
    page.key(box(page), 'Enter');
    assert.equal(page.state().nights.length, 1);
    assert.equal(page.state().nights[0].total, 96);
  } finally {
    await page.close();
  }
});

test('tips mode: no "below your hourly pay" warning; cash is checked against the tips', async () => {
  const page = await boot({ seed: tipsState() });
  try {
    page.type(box(page), '10');
    page.type(hours(page), '8');
    assert.doesNotMatch(page.text(), /Did you include your hourly pay/);
    page.type(cash(page), '50');
    assert.match(page.text(), /Cash is more than the tips you entered/);
  } finally {
    await page.close();
  }
});

test('tips mode with an after-tip-out basis says so in the hint', async () => {
  const page = await boot({ seed: tipsState((S) => (S.workplaces[0].profile.tipout.basis = 'after')) });
  try {
    assert.match(
      page.text(),
      /Cash tips \+ card tips, after paying the barback\. TipNet adds the pay for the jobs below\./,
    );
  } finally {
    await page.close();
  }
});

test('total mode is unchanged: $585 / 8 h / $210 cash -> $420.46, cash you keep $136.65, on check $283.81', async () => {
  const page = await boot({ seed: totalState() });
  try {
    assert.match(page.text(), /What you made tonight/);
    assert.match(page.text(), /Cash \+ card tips \+ all hourly pay, before anything comes out\./);
    page.type(box(page), '585');
    page.type(hours(page), '8');
    page.type(cash(page), '210');
    assert.equal(page.$('.result .hero').textContent, '$420.46');
    assert.match(page.text(), /Cash you keep\$136\.65/);
    assert.match(page.text(), /On your check\$283\.81/);
    submit(page);
    assert.equal(page.state().nights[0].total, 585);
    page.type(box(page), '50');
    page.type(hours(page), '8');
    assert.match(page.text(), /Did you include your hourly pay/, 'the warning stays in total mode');
  } finally {
    await page.close();
  }
});

for (const locked of [false, true]) {
  test(
    'tips mode: "Add to that night" adds the tips and only the new hours’ pay' +
      (locked ? ' (locked night)' : ''),
    async () => {
      const D = today();
      const page = await boot({
        seed: tipsState((S) => {
          // 400 tips + 8 h: $12 now, $10 when the locked night was saved
          const n = { id: 1, date: D, total: locked ? 480 : 496, cash: null, pay: { p1: 8 }, barback: true };
          if (locked) n.snap = lockedAt(S, 10);
          S.nights = [n];
        }),
      });
      try {
        page.type(box(page), '100');
        page.type(hours(page), '2');
        submit(page);
        assert.match(page.text(), /You already saved \$\d+\.00 \(tips \$400\.00\)/);
        page.click(page.button('Add to that night'));
        const ns = page.state().nights;
        assert.equal(ns.length, 1);
        assert.equal(ns[0].pay.p1, 10);
        // tips 400 + 100, hours 8 + 2 at that night's rate: base pay counted once
        assert.equal(ns[0].total, locked ? 600 : 620);
        if (locked) assert.equal(ns[0].snap.pay[0].rate, 10, 'still locked at its own rate');
      } finally {
        await page.close();
      }
    },
  );
}

test('tips mode: "Replace it" on a locked night keeps its rate and stores tips + pay at that rate', async () => {
  const D = today();
  const page = await boot({
    seed: tipsState((S) => {
      S.nights = [
        { id: 1, date: D, total: 480, cash: null, pay: { p1: 8 }, barback: true, snap: lockedAt(S, 10) },
      ];
    }),
  });
  try {
    page.type(box(page), '300');
    page.type(hours(page), '5');
    submit(page);
    page.click(page.button('Replace it'));
    const [n] = page.state().nights;
    assert.equal(n.total, 350); // 300 + 5 x $10
    assert.equal(n.snap.pay[0].rate, 10);
  } finally {
    await page.close();
  }
});

test('Setup: switching the entry mode changes the labels and never the saved nights', async () => {
  const nights = [
    { id: 1, date: '2026-01-05', total: 496, cash: 100, pay: { p1: 8 }, barback: true },
    { id: 2, date: '2026-01-06', total: 300, cash: null, pay: { p1: 6 }, barback: false },
  ];
  const page = await boot({ seed: tipsState((S) => (S.nights = nights)) });
  try {
    const before = JSON.stringify(page.state().nights);
    page.tab('setup');
    assert.match(page.text(), /The number I type each night is:/);
    assert.match(page.text(), /Nights you already saved stay the same\./);
    assert.equal(page.$('#em-tips').checked, true);
    const all = page.$('#em-total');
    all.checked = true;
    page.change(all);
    assert.equal(page.state().workplaces[0].profile.entryMode, 'total');
    assert.equal(JSON.stringify(page.state().nights), before, 'nights untouched');
    page.tab('tonight');
    assert.match(page.text(), /What you made tonight/);
    page.tab('setup');
    const tipsOnly = page.$('#em-tips');
    tipsOnly.checked = true;
    page.change(tipsOnly);
    assert.equal(page.state().workplaces[0].profile.entryMode, 'tips');
    assert.equal(JSON.stringify(page.state().nights), before, 'nights untouched');
    page.tab('tonight');
    assert.match(page.text(), /Tips you made tonight/);
  } finally {
    await page.close();
  }
});

test('guided setup offers the entry-mode choice with tips preselected for a new user', async () => {
  const page = await boot();
  try {
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.click(page.button('Next'));
    page.click(page.$('#no-ded'));
    page.click(page.button('Next'));
    assert.match(page.text(), /Just my tips \(cash \+ card\)\. TipNet adds my hourly pay\./);
    assert.match(page.text(), /Everything: tips plus my hourly pay/);
    assert.equal(page.$('#em-tips').checked, true);
    assert.equal(page.$('#em-total').checked, false);
    const all = page.$('#em-total');
    all.checked = true;
    page.change(all);
    page.type(page.$('input[placeholder="e.g. 12"]', page.app), '10');
    page.click(page.button('Finish setup'));
    assert.equal(page.state().workplaces[0].profile.entryMode, 'total', 'the choice is kept on Finish');
    assert.match(page.text(), /What you made tonight/);
  } finally {
    await page.close();
  }
});

/* ---------- Pay periods: rows and the night editor ---------- */
const openEditor = (page, date) => page.click(page.must(page.byLabel('Edit night ' + date), 'Edit ' + date));
const editBox = (page, id) => page.must(page.$('[data-focus-key="edit-' + id + '-total"]'), 'editor box');
const saveEdit = (page) => page.click(page.button('Save changes'));

test('Pay periods rows: "made $X", plus "tips $Y" in tips mode only', async () => {
  const nights = [{ id: 1, date: today(), total: 496, cash: null, pay: { p1: 8 }, barback: false }];
  for (const [seed, tips] of [
    [tipsState((S) => (S.nights = nights)), true],
    [totalState((S) => (S.nights = nights)), false],
  ]) {
    const page = await boot({ seed });
    try {
      page.tab('periods');
      const row = page.$('.list-row .hint').textContent;
      assert.match(row, /^Bartender 8 h · made \$496\.00/);
      if (tips) assert.match(row, /tips \$400\.00/);
      else assert.doesNotMatch(row, /tips \$/);
    } finally {
      await page.close();
    }
  }
});

test('night editor, tips mode: shows the tips, round-trips unchanged, converts edits back (locked night at its own rate)', async () => {
  const D = today();
  const page = await boot({
    seed: tipsState((S) => {
      S.nights = [
        { id: 1, date: D, total: 496, cash: null, pay: { p1: 8 }, barback: false },
        {
          id: 2,
          date: '2026-01-05',
          total: 480,
          cash: 50,
          pay: { p1: 8 },
          barback: false,
          snap: lockedAt(S, 10),
        },
      ];
    }),
  });
  try {
    page.tab('periods');
    const { fmtDate } = await import('../../app/js/ui/common.js');
    // unlocked: 496 - 8 x 12
    openEditor(page, fmtDate(D));
    assert.match(page.text(), /Tips you made/);
    assert.equal(editBox(page, 1).value, '400');
    saveEdit(page);
    assert.equal(page.state().nights.find((n) => n.id === 1).total, 496, 'unchanged round trip');
    openEditor(page, fmtDate(D));
    page.type(editBox(page, 1), '450');
    saveEdit(page);
    assert.equal(page.state().nights.find((n) => n.id === 1).total, 546);

    // locked at $10: 480 - 8 x 10
    openEditor(page, fmtDate('2026-01-05'));
    assert.equal(editBox(page, 2).value, '400');
    saveEdit(page);
    assert.equal(page.state().nights.find((n) => n.id === 2).total, 480, 'locked, unchanged round trip');
    openEditor(page, fmtDate('2026-01-05'));
    page.type(editBox(page, 2), '420');
    saveEdit(page);
    let n2 = page.state().nights.find((n) => n.id === 2);
    assert.equal(n2.total, 500, '420 + 8 x $10 (its own rate)');
    assert.equal(n2.snap.pay[0].rate, 10);

    // Recalculate with current Setup: the tips stay, the pay follows today's $12
    openEditor(page, fmtDate('2026-01-05'));
    assert.equal(editBox(page, 2).value, '420');
    const re = page.$('#edit-2-recalc');
    re.checked = true;
    page.change(re);
    saveEdit(page);
    n2 = page.state().nights.find((n) => n.id === 2);
    assert.equal(n2.total, 516, '420 + 8 x $12');
    assert.equal(n2.snap.pay[0].rate, 12);
  } finally {
    await page.close();
  }
});

test('night editor, total mode: edits the stored total directly (locked night too)', async () => {
  const page = await boot({
    seed: totalState((S) => {
      S.nights = [
        {
          id: 2,
          date: '2026-01-05',
          total: 480,
          cash: 50,
          pay: { p1: 8 },
          barback: false,
          snap: lockedAt(S, 10),
        },
      ];
    }),
  });
  try {
    page.tab('periods');
    const { fmtDate } = await import('../../app/js/ui/common.js');
    openEditor(page, fmtDate('2026-01-05'));
    assert.match(page.text(), /What you made/);
    assert.equal(editBox(page, 2).value, '480');
    saveEdit(page);
    assert.equal(page.state().nights[0].total, 480);
    openEditor(page, fmtDate('2026-01-05'));
    page.type(editBox(page, 2), '510');
    saveEdit(page);
    assert.equal(page.state().nights[0].total, 510);
    assert.equal(page.state().nights[0].snap.pay[0].rate, 10);
  } finally {
    await page.close();
  }
});
