// Tonight and the night editor ask for CC tips and Cash tips (before tip-outs); TipNet adds the pay for the jobs worked.
// tips = CC + Cash, cash = Cash, total = tips + pay at the night's rates. Old nights keep their money: a night typed as
// one total before v38 shows CC = its tips - its cash; a night saved without cash shows Cash blank and keeps it unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';
import { snapshotFor, computeNight } from '../../app/js/math.js';
import { fmtDate } from '../../app/js/ui/common.js';

const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const cc = (page) => page.must(page.$('[data-focus-key="night-cc"]'), 'CC tips field');
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

test('Tonight: CC + cash + hours; the breakdown, and the saved night stores tips + hourly pay and matches the preview', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(cc(page), '230');
    page.type(cash(page), '120');
    page.type(hours(page), '6:30');
    assert.match(page.text(), /Made tonight\$428\.00/); // 350 + 6.5 x $12
    assert.match(page.text(), /of which base pay\$78\.00/);
    assert.match(page.text(), /of which tips\$350\.00/);
    const hero = page.$('.result .hero').textContent;
    submit(page);
    const [n] = page.state().nights;
    assert.equal(n.total, 428);
    assert.equal(n.tips, 350);
    assert.equal(n.pay.p1, 6.5);
    assert.equal(n.cash, 120);
    assert.ok(page.$('p.hint[role=status]').textContent.includes(hero), 'preview == saved');
    assert.equal(computeNight(n, page.state().workplaces[0].profile, 10).net > 0, true);
    assert.equal(page.doc.activeElement, cc(page), 'focus back on the CC tips box');
  } finally {
    await page.close();
  }
});

test('Tonight: amounts are kept to the cent, and CC + cash add up exactly', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(cc(page), '0.1');
    page.type(cash(page), '0.2');
    page.type(hours(page), '1');
    submit(page);
    const [n] = page.state().nights;
    assert.equal(n.tips, 0.3);
    assert.equal(n.cash, 0.2);
    assert.equal(n.total, 12.3);
  } finally {
    await page.close();
  }
});

test('hours are typed each night: empty at first, never the usual amount, nothing remembered after saving', async () => {
  const page = await boot({ seed: seed() });
  try {
    assert.equal(hours(page).value, '', 'empty, although the profile still has a usual amount');
    page.type(cc(page), '200');
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

test('hours are required to save (0 is fine when typed)', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(cc(page), '200');
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

test('only cash tips, CC blank: the CC tips are $0', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(cash(page), '75');
    page.type(hours(page), '5');
    submit(page);
    const [n] = page.state().nights;
    assert.equal(n.tips, 75);
    assert.equal(n.cash, 75);
    assert.equal(n.total, 135);
  } finally {
    await page.close();
  }
});

for (const locked of [false, true]) {
  test(
    '"Add to that night" adds the tips and only the new hours’ pay; a night saved without cash keeps it unknown' +
      (locked ? ' (locked night)' : ''),
    async () => {
      const D = today();
      const page = await boot({
        seed: seed((S) => {
          // 400 tips + 8 h: $12 now, $10 when the locked night was saved; typed as one total, no cash
          const n = { id: 1, date: D, total: locked ? 480 : 496, cash: null, pay: { p1: 8 }, barback: true };
          if (locked) n.snap = lockedAt(S, 10);
          S.nights = [n];
        }),
      });
      try {
        page.type(cc(page), '60');
        page.type(cash(page), '40');
        page.type(hours(page), '2');
        submit(page);
        assert.match(page.text(), /You already saved \$\d+\.00 \(tips \$400\.00\)/);
        page.click(page.button('Add to that night'));
        const ns = page.state().nights;
        assert.equal(ns.length, 1);
        assert.equal(ns[0].pay.p1, 10);
        // tips 400 + 100, hours 8 + 2 at that night's rate: base pay counted once
        assert.equal(ns[0].tips, 500);
        assert.equal(ns[0].total, locked ? 600 : 620);
        assert.equal(ns[0].cash, null, 'its cash was never entered, so it stays unknown');
        if (locked) assert.equal(ns[0].snap.pay[0].rate, 10, 'still locked at its own rate');
      } finally {
        await page.close();
      }
    },
  );
}

test('"Add to that night" on a night with cash adds the cash; cash that skipped payroll stays so', async () => {
  const D = today();
  const page = await boot({
    seed: seed((S) => {
      S.nights = [
        {
          id: 1,
          date: D,
          total: 496,
          tips: 400,
          cash: 100,
          cashOffPayroll: true,
          pay: { p1: 8 },
          barback: true,
        },
      ];
    }),
  });
  try {
    page.type(cc(page), '50');
    page.type(hours(page), '1');
    submit(page);
    page.click(page.button('Add to that night'));
    const [n] = page.state().nights;
    assert.equal(n.tips, 450);
    assert.equal(n.cash, 100, 'blank cash added $0');
    assert.equal(n.cashOffPayroll, true, 'a part with no cash says nothing about the cash');
  } finally {
    await page.close();
  }
});

test('"Replace it" on a locked night keeps its rate and stores tips + pay at that rate', async () => {
  const D = today();
  const page = await boot({
    seed: seed((S) => {
      S.nights = [
        { id: 1, date: D, total: 480, cash: null, pay: { p1: 8 }, barback: true, snap: lockedAt(S, 10) },
      ];
    }),
  });
  try {
    page.type(cc(page), '300');
    page.type(hours(page), '5');
    submit(page);
    page.click(page.button('Replace it'));
    const [n] = page.state().nights;
    assert.equal(n.total, 350); // 300 + 5 x $10
    assert.equal(n.tips, 300);
    assert.equal(n.cash, 0);
    assert.equal(n.snap.pay[0].rate, 10);
  } finally {
    await page.close();
  }
});

test('Setup and guided setup have no entry-mode choice any more', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    assert.doesNotMatch(page.text(), /The number I type each night is/);
    assert.equal(page.$('#em-tips'), null);
    assert.match(page.text(), /On Tonight you type your CC tips, cash tips and hours; TipNet adds the pay\./);
  } finally {
    await page.close();
  }
  const g = await boot();
  try {
    g.type(g.$$('input[type=date]', g.app)[0], '2026-09-01');
    g.type(g.$('input[placeholder="e.g. 2,000"]', g.app), '1500');
    g.click(g.button('Next'));
    g.click(g.$('#no-ded'));
    g.click(g.button('Next'));
    assert.doesNotMatch(g.text(), /Just my tips|Everything: tips plus/);
    g.type(g.$('input[placeholder="e.g. 12"]', g.app), '10');
    g.click(g.button('Finish setup'));
    assert.equal('entryMode' in g.state().workplaces[0].profile, false);
    assert.ok(g.$('[data-focus-key="night-cc"]'), 'Tonight asks for CC tips');
    assert.ok(g.$('[data-focus-key="night-cash"]'), 'and Cash tips');
  } finally {
    await g.close();
  }
});

/* ---------- Pay periods: rows and the night editor ---------- */
const openEditor = (page, date) => page.click(page.must(page.byLabel('Edit night ' + date), 'Edit ' + date));
const editCc = (page, id) => page.must(page.$('[data-focus-key="edit-' + id + '-cc"]'), 'editor CC box');
const editCash = (page, id) =>
  page.must(page.$('[data-focus-key="edit-' + id + '-cash"]'), 'editor cash box');
const saveEdit = (page) => page.click(page.button('Save changes'));
const nightOf = (page, id) => page.state().nights.find((n) => n.id === id);

test('Pay periods rows: "made $X · tips $Y"', async () => {
  const page = await boot({
    seed: seed((S) => {
      S.nights = [{ id: 1, date: today(), total: 496, cash: null, pay: { p1: 8 }, barback: false }];
    }),
  });
  try {
    page.tab('periods');
    assert.match(page.$('.list-row .hint').textContent, /^Bartender 8 h · made \$496\.00 · tips \$400\.00/);
  } finally {
    await page.close();
  }
});

test('night editor: a night typed as one total shows CC = tips - cash; unchanged it keeps its total exactly; edited it stores tips + pay', async () => {
  const D = today();
  const page = await boot({
    seed: seed((S) => {
      S.nights = [{ id: 1, date: D, total: 496, cash: 150, pay: { p1: 8 }, barback: false }];
    }),
  });
  try {
    page.tab('periods');
    openEditor(page, fmtDate(D));
    assert.equal(editCc(page, 1).value, '250');
    assert.equal(editCash(page, 1).value, '150');
    assert.equal(page.$('[data-focus-key="edit-1-cash-unknown"]'), null);
    const p = page.state().workplaces[0].profile;
    const before = computeNight(nightOf(page, 1), p, 10);
    page.type(page.$('#edit-1-note'), 'busy');
    saveEdit(page);
    const n = nightOf(page, 1);
    assert.equal(n.total, 496);
    assert.equal(n.cash, 150);
    assert.equal('tips' in n, false, 'still a total night');
    assert.deepEqual(computeNight(n, p, 10), before, 'the same money');
    openEditor(page, fmtDate(D));
    page.type(editCc(page, 1), '300');
    saveEdit(page);
    const e = nightOf(page, 1);
    assert.equal(e.tips, 450);
    assert.equal(e.total, 546);
    assert.equal(e.cash, 150);
  } finally {
    await page.close();
  }
});

test('night editor: typed tips with cash, locked at its own rate: round-trips unchanged, edits at that rate', async () => {
  const page = await boot({
    seed: seed((S) => {
      S.nights = [
        {
          id: 2,
          date: '2026-01-05',
          total: 480,
          tips: 400,
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
    openEditor(page, fmtDate('2026-01-05'));
    assert.equal(editCc(page, 2).value, '350');
    assert.equal(editCash(page, 2).value, '50');
    saveEdit(page);
    assert.equal(nightOf(page, 2).total, 480, 'locked, unchanged round trip');
    assert.equal(nightOf(page, 2).tips, 400);
    openEditor(page, fmtDate('2026-01-05'));
    page.type(editCc(page, 2), '370');
    saveEdit(page);
    let n2 = nightOf(page, 2);
    assert.equal(n2.tips, 420);
    assert.equal(n2.total, 500, '420 + 8 x $10 (its own rate)');
    assert.equal(n2.snap.pay[0].rate, 10);
    // its pay period updated to today's Setup: the tips stay, the pay follows today's $12
    page.click(page.button('Update this pay period to today’s Setup'));
    page.click(page.button('Update pay period'));
    n2 = nightOf(page, 2);
    assert.equal(n2.tips, 420);
    assert.equal(n2.total, 516, '420 + 8 x $12');
    assert.equal(n2.snap.pay[0].rate, 12);
  } finally {
    await page.close();
  }
});

test('night editor: a night saved without cash shows Cash blank and all its tips as CC; its cash stays unknown until typed', async () => {
  const D = today();
  const page = await boot({
    seed: seed((S) => {
      S.nights = [{ id: 1, date: D, total: 496, cash: null, pay: { p1: 8 }, barback: false }];
    }),
  });
  try {
    page.tab('periods');
    openEditor(page, fmtDate(D));
    assert.equal(editCc(page, 1).value, '400');
    assert.equal(editCash(page, 1).value, '');
    assert.match(
      page.must(page.$('[data-focus-key="edit-1-cash-unknown"]'), 'note').textContent,
      /saved without a cash amount, so CC tips shows all its tips/,
    );
    saveEdit(page);
    assert.equal(nightOf(page, 1).cash, null);
    assert.equal(nightOf(page, 1).total, 496);
    // the hours edited, cash still blank: the cash stays unknown (what lands on the check stays unknown)
    openEditor(page, fmtDate(D));
    page.type(page.$('[data-focus-key="edit-1-pay-p1"]'), '7');
    saveEdit(page);
    let n = nightOf(page, 1);
    assert.equal(n.cash, null);
    assert.equal(n.tips, 400);
    assert.equal(n.total, 484);
    assert.equal(computeNight(n, page.state().workplaces[0].profile, 10).onCheck, null);
    // cash typed (and taken out of CC tips): it is stored
    openEditor(page, fmtDate(D));
    page.type(editCc(page, 1), '300');
    page.type(editCash(page, 1), '100');
    saveEdit(page);
    n = nightOf(page, 1);
    assert.equal(n.cash, 100);
    assert.equal(n.tips, 400);
    assert.equal(n.total, 484);
  } finally {
    await page.close();
  }
});

test('night editor: a night saved with more cash than tips says so; changing only its hours keeps its tips and cash', async () => {
  const D = today();
  const page = await boot({
    seed: seed((S) => {
      // $120 made with 8 h x $12 = $96 pay: $24 of tips, but $50 cash (an old import)
      S.nights = [{ id: 1, date: D, total: 120, cash: 50, pay: { p1: 8 }, barback: false }];
    }),
  });
  try {
    page.tab('periods');
    openEditor(page, fmtDate(D));
    assert.equal(editCc(page, 1).value, '0');
    assert.equal(editCash(page, 1).value, '50');
    assert.match(
      page.must(page.$('[data-focus-key="edit-1-cash-over"]'), 'note').textContent,
      /saved with more cash than tips, so CC tips shows \$0\. Check both amounts\./,
    );
    page.type(page.$('[data-focus-key="edit-1-pay-p1"]'), '7');
    saveEdit(page);
    const n = nightOf(page, 1);
    assert.equal(n.tips, 24, 'its tips, not CC + cash');
    assert.equal(n.cash, 50);
    assert.equal(n.total, 108);
  } finally {
    await page.close();
  }
});
