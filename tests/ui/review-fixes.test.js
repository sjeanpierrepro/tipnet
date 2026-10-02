// Setup keeps the accuracy adjustment unless the paystub rates change; Tonight's quick take-home line; the cash-tax
// wording when cash wasn't run through payroll; Budget's "Log a night with its cash" hint; the update bar between windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { RATE_NOTE } from '../../app/js/ui/setup.js';
import { updateAction } from '../../app/js/ui/common.js';
import { exampleBudget } from '../../app/js/budget.js';
import { todayISO, addDays } from '../../app/js/math.js';

const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.rateOverride = 0.2;
    if (mutate) mutate(S);
  });
const override = (page) => page.state().workplaces[0].profile.rateOverride;
/** The amount box in a deduction row (the row is found through its "how it changes" select, id dm-<id>). */
function dedAmount(page, id) {
  const mode = page.must(page.$('#dm-' + id), 'deduction ' + id);
  return page.must(mode.closest('.repeat-row').querySelector('input[inputmode=decimal]'), 'amount ' + id);
}

test('setup: a fixed deduction change or a new empty deduction keeps the accuracy adjustment', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    page.type(dedAmount(page, 'd4'), '75'); // health insurance, same every check
    page.click(page.button('+ Add deduction')); // a new deduction with no amount yet
    assert.doesNotMatch(page.text(), /saving clears/);
    await page.saveSetup();
    assert.equal(override(page), 0.2);
    assert.doesNotMatch(page.text(), /accuracy adjustment was cleared/);
  } finally {
    await page.close();
  }
});

test('setup: a percentage deduction or gross pay change clears it and says so; putting it back restores it', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.openSetup();
    const fed = dedAmount(page, 'd1');
    page.type(fed, '200');
    page.change(fed); // numbers that change the rate apply on leaving the field (or after a pause)
    assert.equal(override(page), 0.2, 'nothing changes before Save');
    assert.match(page.text(), /so saving clears TipNet’s accuracy adjustment/, 'it says so beforehand');
    page.type(fed, '180'); // back again before saving: nothing to clear
    page.change(fed);
    assert.doesNotMatch(page.text(), /saving clears/);
    page.type(fed, '200');
    page.change(fed);
    await page.saveSetup();
    assert.equal(override(page), null);
    assert.ok(page.text().includes(RATE_NOTE), 'the note shows');
    page.openSetup();
    page.type(dedAmount(page, 'd1'), '180'); // back to what it was learned with
    await page.saveSetup();
    assert.equal(override(page), 0.2, 'restored');
    assert.ok(!page.text().includes(RATE_NOTE));
    // gross pay
    page.openSetup();
    const gross = page.$$('input').find((i) => i.value === '2000');
    page.type(gross, '2100');
    await page.saveSetup();
    assert.equal(override(page), null);
    assert.ok(page.text().includes(RATE_NOTE));
  } finally {
    await page.close();
  }
});

test('setup: the adjustment is per restaurant; another restaurant’s edit leaves it alone', async () => {
  const page = await boot({
    seed: seed((S) => {
      const w2 = JSON.parse(JSON.stringify(S.workplaces[0]));
      w2.id = 'w2';
      w2.name = 'Second Spot';
      w2.profile.rateOverride = 0.15;
      S.workplaces.push(w2);
      S.settings.activeWorkplaceId = 'w2';
    }),
  });
  try {
    page.openSetup('Second Spot');
    page.type(dedAmount(page, 'd1'), '210');
    await page.saveSetup();
    const [a, b] = page.state().workplaces;
    assert.equal(b.profile.rateOverride, null, 'Second Spot cleared');
    assert.equal(a.profile.rateOverride, 0.2, 'the first restaurant keeps its own');
  } finally {
    await page.close();
  }
});

test('tonight: a live take-home line right under the tips box follows the typing', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.entryMode = 'tips';
    }),
  });
  try {
    const quick = page.must(page.$('.quick-net'), 'quick line');
    const box = page.$('[data-focus-key="night-total"]').closest('.field');
    assert.equal(box.nextElementSibling, quick, 'right under the tips box');
    assert.equal(quick.hidden, true, 'empty before typing');
    assert.equal(quick.getAttribute('aria-live'), null, 'not a second live region');
    page.type(page.$('[data-focus-key="night-total"]'), '150');
    assert.equal(quick.hidden, false);
    assert.match(quick.textContent, /Add tonight’s hours to see your take-home\./);
    page.type(page.$('[data-focus-key="night-pay-p1"]'), '6');
    assert.match(quick.textContent, /^Estimated take-home: \$\d/);
    const hero = page.$('.hero').textContent;
    assert.ok(quick.textContent.endsWith(hero), 'same number as the full card');
    assert.equal(page.$$('[aria-live]', page.app).filter((n) => n.matches('.sr-only')).length, 1);
  } finally {
    await page.close();
  }
});

test('tonight: "Taxes on cash tips usually come out of the paycheck" is hidden while cash is marked off payroll', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
  });
  try {
    page.type(page.$('[data-focus-key="night-total"]'), '300');
    page.type(page.$('[data-focus-key="night-pay-p1"]'), '6');
    const cash = page.$$('input', page.app).find((i) => /cash/i.test(i.getAttribute('data-focus-key') || ''));
    page.type(page.must(cash, 'cash box'), '40');
    const general = /Taxes on cash tips usually come out of the paycheck/;
    assert.match(page.text(), general, 'unticked: shown');
    const off = page.must(
      page
        .$$('input[type=checkbox]', page.app)
        .find((c) =>
          /weren’t run through payroll/.test(c.closest('label') ? c.closest('label').textContent : ''),
        ),
      'off-payroll box',
    );
    off.checked = true;
    page.change(off);
    assert.doesNotMatch(page.text(), general, 'ticked: hidden');
    assert.match(page.text(), /Set aside about \$/);
  } finally {
    await page.close();
  }
});

test('budget: "Log a night with its cash in hand" only while no cash is logged this pay period', async () => {
  const DEV = 'http://localhost/?unlock=dev';
  const base = (withCash) =>
    realState((S) => {
      S.workplaces[0].setupDone = true;
      // the next check pays for the period that just ended (no nights in it); tonight's cash is in the new one
      S.workplaces[0].profile.periodStart = addDays(todayISO(), -15);
      S.workplaces[0].profile.payDelay = 5;
      S.budget = exampleBudget();
      S.nights = withCash
        ? [
            {
              id: 'n1',
              date: todayISO(),
              total: 300,
              cash: 100,
              pay: { p1: 6 },
              barback: true,
              workplaceId: 'w1',
            },
          ]
        : [];
    });
  for (const withCash of [false, true]) {
    const page = await boot({ url: DEV, seed: base(withCash) });
    try {
      page.tab('budget');
      const says = /Log a night with its cash in hand/.test(page.text());
      if (withCash) assert.equal(says, false, 'cash logged: not asked again');
      else if (/Not known yet/.test(page.text())) assert.equal(says, true, 'nothing logged: asked');
    } finally {
      await page.close();
    }
  }
});

test('update: Refresh in another window reloads this one only when nothing is typed here', () => {
  assert.equal(updateAction({ askedHere: true, offered: true, unsaved: true }), 'reload', 'tapped here');
  assert.equal(updateAction({ askedHere: false, offered: true, unsaved: false }), 'reload');
  assert.equal(updateAction({ askedHere: false, offered: true, unsaved: true }), 'offer', 'typing kept');
  assert.equal(updateAction({ askedHere: false, offered: false, unsaved: false }), 'ignore', 'first install');
});

test('update: a half-typed Tonight entry counts as unsaved input', async () => {
  const tonight = await import('../../app/js/ui/tonight.js');
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
  });
  try {
    assert.equal(tonight.hasDraftInput(), false);
    page.type(page.$('[data-focus-key="night-total"]'), '12');
    assert.equal(tonight.hasDraftInput(), true);
    page.tab('periods'); // still kept while another tab is open
    assert.equal(tonight.hasDraftInput(), true);
  } finally {
    await page.close();
  }
});
