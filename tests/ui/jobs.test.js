// Jobs on Setup and Tonight: pick the job(s) worked, type the hours, the rate fills in. Other pay stays hidden until asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { businessDate } from '../../app/js/inputs.js';
import { JOB_PRESETS, OTHER_PAY_PRESETS } from '../../app/js/math.js';
import * as storage from '../../app/js/storage.js';

const jobsState = (mode = 'tips', mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.entryMode = mode;
    S.workplaces[0].profile.tipout.on = false;
    S.workplaces[0].profile.payTypes = [
      { id: 'bar', k: 'bartender', name: 'Bartender', unit: 'hr', rate: 12, usual: 7 },
      { id: 'prep', k: 'prep', name: 'Prep', unit: 'hr', rate: 10, usual: 0 },
      { id: 'lead', k: 'lead', name: 'Supervisor / shift lead', unit: 'hr', rate: 15, usual: 0 },
      { id: 'ot', k: 'ot', name: 'Overtime', unit: 'hr', rate: 18, usual: 0 },
      { id: 'bonus', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0, usual: 0, supp: 1 },
    ];
    if (mutate) mutate(S);
  });
const box = (page) => page.must(page.$('[data-focus-key="night-total"]'), 'tips/total box');
const job = (page, r) => page.must(page.$('[data-focus-key="night-job-' + r + '"]'), 'job ' + r);
const hrs = (page, id) => page.must(page.$('[data-focus-key="night-pay-' + id + '"]'), 'hours ' + id);
const submit = (page) => page.click(page.$('form button[type=submit]'));
const pick = (page, sel, v) => {
  sel.value = v;
  page.change(sel);
};
const optionTexts = (sel) => Array.from(sel.querySelectorAll('option')).map((o) => o.textContent);
const today = () => businessDate(new Date(), 6);

/* ---------- Setup ---------- */
test('guided setup step 3: jobs with every job preset, other pay with every other-pay preset, no "usual" fields', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.click(page.button('Next'));
    page.click(page.$('#no-ded'));
    page.click(page.button('Next'));
    const t = page.text();
    assert.match(t, /Your jobs and pay/);
    assert.match(t, /Jobs.*Main job/);
    assert.match(t, /Other pay/);
    assert.doesNotMatch(t, /Usual per night|Default per night/);
    assert.equal(page.$$('input[id^="pq-"]').length, 0);
    const main = page.$('select[id^="pk-"]', page.app);
    const names = optionTexts(main);
    JOB_PRESETS.forEach((pr) => assert.ok(names.includes(pr.name), pr.name));
    // other pay: add a row, its dropdown has every other-pay preset; overtime is 1.5x the main job's rate
    page.type(page.$('#pr-p1'), '12');
    page.click(page.button('+ Add other pay'));
    const sels = page.$$('select[id^="pk-"]', page.app);
    const other = sels[sels.length - 1];
    const otherNames = optionTexts(other);
    OTHER_PAY_PRESETS.forEach((pr) => assert.ok(otherNames.includes(pr.name), pr.name));
    assert.equal(other.value, 'ot');
    const otRate = page.$('#pr-' + other.id.slice(3));
    assert.equal(otRate.value, '18');
    // add jobs: Prep $10, Supervisor $15
    for (const [k, rate] of [
      ['prep', '10'],
      ['lead', '15'],
    ]) {
      page.click(page.button('+ Add a job'));
      const js = page
        .$$('select[id^="pk-"]', page.app)
        .filter((s) => s.querySelector('option[value="bartender"]'));
      const s = js[js.length - 1];
      pick(page, s, k);
      page.type(page.$('#pr-' + s.id.slice(3)), rate);
    }
    page.click(page.button('Finish setup'));
    const p = page.state().workplaces[0].profile;
    assert.deepEqual(
      p.payTypes.map((x) => [x.k, x.rate]),
      [
        ['bartender', 12],
        ['ot', 18],
        ['prep', 10],
        ['lead', 15],
      ],
    );
  } finally {
    await page.close();
  }
});

test('full Setup page: jobs and other pay sections with every preset; an old "Hourly"/"Training" profile shows as jobs', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile.payTypes = [
        { id: 'p1', k: 'hourly', name: 'Hourly', unit: 'hr', rate: 12, usual: 7 },
        { id: 'p2', k: 'training', name: 'Training', unit: 'hr', rate: 15, usual: 0 },
        { id: 'p3', k: 'bonus', name: 'Bonus', unit: 'amt', rate: 0, usual: 0, supp: 1 },
      ];
    }),
  });
  try {
    page.tab('setup');
    const t = page.text();
    assert.match(t, /Your jobs and pay/);
    assert.doesNotMatch(t, /Usual per night|Default per night/);
    assert.equal(page.$('#pk-p1').value, 'hourly', 'the old main type keeps its kind');
    assert.equal(page.$('#pn-p1').value, 'Hourly', 'and its name');
    assert.equal(page.$('#pk-p2').value, 'training');
    assert.ok(page.$('#pk-p2').querySelector('option[value="bartender"]'), 'Training is a job');
    assert.ok(page.$('#pk-p3').querySelector('option[value="bonus"]'), 'Bonus is other pay');
    assert.equal(page.$('#pk-p3').querySelector('option[value="bartender"]'), null);
    const all = optionTexts(page.$('#pk-p1')).concat(optionTexts(page.$('#pk-p3')));
    JOB_PRESETS.concat(OTHER_PAY_PRESETS).forEach((pr) => assert.ok(all.includes(pr.name), pr.name));
    assert.equal(page.byLabel('Remove Training').tagName, 'BUTTON');
    assert.equal(page.$$('button[aria-label="Remove Hourly"]').length, 0, 'the main job cannot be removed');
    assert.equal(page.state().workplaces[0].profile.payTypes.length, 3, 'nothing lost');
  } finally {
    await page.close();
  }
});

/* ---------- Tonight ---------- */
test('Tonight: main job preselected with empty hours; the rate fills in; add, pick and remove jobs', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    assert.match(page.text(), /What did you work tonight\?/);
    assert.equal(job(page, 0).value, 'bar');
    assert.equal(hrs(page, 'bar').value, '');
    assert.match(page.text(), /\$12\.00\/h/);
    page.type(hrs(page, 'bar'), '8');
    assert.match(page.text(), /\$12\.00\/h → \$96\.00/);
    // a second job: the next unused one, and a job can't be picked twice
    page.click(page.button('+ Add another job'));
    assert.equal(job(page, 1).value, 'prep');
    assert.equal(hrs(page, 'prep').value, '');
    assert.equal(job(page, 1).querySelector('option[value="bar"]').disabled, true);
    assert.equal(job(page, 0).querySelector('option[value="prep"]').disabled, true);
    assert.equal(job(page, 0).querySelector('option[value="lead"]').disabled, false);
    pick(page, job(page, 1), 'bar');
    assert.equal(job(page, 1).value, 'prep', 'a job already in a row is refused');
    pick(page, job(page, 1), 'lead');
    page.type(hrs(page, 'lead'), '2');
    assert.match(page.text(), /\$15\.00\/h → \$30\.00/);
    // other pay types are never in the job list
    assert.equal(job(page, 0).querySelector('option[value="ot"]'), null);
    // remove the extra row
    page.click(page.byLabel('Remove Supervisor / shift lead'));
    assert.equal(page.$('[data-focus-key="night-job-1"]'), null);
    assert.equal(page.$$('button[aria-label^="Remove"]', page.app).length, 0, 'the first row has no Remove');
    page.type(box(page), '100');
    submit(page);
    assert.deepEqual(page.state().nights[0].pay, { bar: 8, prep: 0, lead: 0, ot: 0, bonus: 0 });
  } finally {
    await page.close();
  }
});

test('Tonight: hours are required, over 24 and negative hours are refused, and so is a total over 24', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    page.type(box(page), '100');
    submit(page);
    assert.match(page.text(), /Enter the hours you worked tonight\./);
    assert.equal(page.doc.activeElement, hrs(page, 'bar'));
    for (const [v, msg] of [
      ['25', /more than 24 hours in one night/],
      ['-5', /Hours can’t be a negative number/],
      ['abc', /Hours should be a number, like 6 or 7:30/],
    ]) {
      page.type(hrs(page, 'bar'), v);
      assert.match(page.text(), msg, v);
      submit(page);
      assert.equal(page.state().nights.length, 0, v + ' is not saved');
    }
    page.type(hrs(page, 'bar'), '14');
    page.click(page.button('+ Add another job'));
    page.type(hrs(page, 'prep'), '11');
    assert.match(page.text(), /Your hours add up to more than 24 in one night/);
    submit(page);
    assert.equal(page.state().nights.length, 0);
    page.type(hrs(page, 'prep'), '2:30');
    submit(page);
    assert.equal(page.state().nights.length, 1);
    assert.equal(page.state().nights[0].pay.prep, 2.5);
  } finally {
    await page.close();
  }
});

test('Tonight: other pay is hidden until "+ Add other pay"', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    assert.equal(page.$('[data-focus-key="night-pay-bonus"]'), null, 'no Bonus box for everyone');
    assert.equal(page.$('[data-focus-key="night-pay-ot"]'), null);
    page.click(page.button('+ Add other pay'));
    assert.ok(page.$('[data-focus-key="night-pay-ot"]'));
    assert.ok(page.$('[data-focus-key="night-pay-bonus"]'));
    assert.equal(page.doc.activeElement, page.$('[data-focus-key="night-pay-ot"]'));
    page.type(box(page), '100');
    page.type(hrs(page, 'bar'), '8');
    page.type(page.$('[data-focus-key="night-pay-ot"]'), '2');
    page.type(page.$('[data-focus-key="night-pay-bonus"]'), '50');
    submit(page);
    const [n] = page.state().nights;
    assert.equal(n.pay.ot, 2);
    assert.equal(n.pay.bonus, 50);
    assert.equal(n.total, 100 + 96 + 36);
    assert.equal(page.$('[data-focus-key="night-pay-bonus"]'), null, 'hidden again for the next night');
  } finally {
    await page.close();
  }
});

for (const mode of ['tips', 'total']) {
  test(mode + ' mode: a double (Prep 2 h + Bartender 6 h), preview == saved', async () => {
    const page = await boot({ seed: jobsState(mode) });
    try {
      pick(page, job(page, 0), 'prep');
      page.type(hrs(page, 'prep'), '2');
      page.click(page.button('+ Add another job'));
      assert.equal(job(page, 1).value, 'bar');
      page.type(hrs(page, 'bar'), '6');
      page.type(box(page), mode === 'tips' ? '400' : '492');
      assert.match(page.text(), /Made tonight\$492\.00/);
      assert.match(page.text(), /of which base pay\$92\.00/);
      assert.match(page.text(), /of which tips\$400\.00/);
      const hero = page.$('.result .hero').textContent;
      submit(page);
      const [n] = page.state().nights;
      assert.equal(n.total, 492);
      assert.deepEqual(n.pay, { bar: 6, prep: 2, lead: 0, ot: 0, bonus: 0 });
      if (mode === 'tips') assert.equal(n.tips, 400);
      else assert.equal(n.tips, undefined);
      assert.ok(page.$('p.hint[role=status]').textContent.includes(hero), 'saved take-home == preview');
      assert.equal(job(page, 0).value, 'bar', 'the next night starts on the main job again');
      assert.equal(hrs(page, 'bar').value, '');
    } finally {
      await page.close();
    }
  });
}

test('tips mode: no numbers until the hours are in', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    page.type(box(page), '400');
    assert.match(page.text(), /Add tonight’s hours to see your take-home\./);
    assert.equal(page.$('.result .hero'), null);
    page.type(hrs(page, 'bar'), '8');
    assert.ok(page.$('.result .hero'));
  } finally {
    await page.close();
  }
});

test('same date, "Add to that night": job hours merge by job', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    pick(page, job(page, 0), 'prep');
    page.type(hrs(page, 'prep'), '2');
    page.type(box(page), '100');
    submit(page);
    page.type(hrs(page, 'bar'), '6');
    page.click(page.button('+ Add another job'));
    page.type(hrs(page, 'prep'), '1');
    page.type(box(page), '300');
    submit(page);
    assert.match(page.text(), /You already saved .*Prep 2 h/);
    page.click(page.button('Add to that night'));
    const ns = page.state().nights;
    assert.equal(ns.length, 1);
    assert.equal(ns[0].pay.prep, 3);
    assert.equal(ns[0].pay.bar, 6);
    assert.equal(ns[0].tips, 400);
    assert.equal(ns[0].total, 400 + 30 + 72);
  } finally {
    await page.close();
  }
});

test('changing a job rate later keeps the tips typed in tips mode (the period is not finished)', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    page.type(box(page), '400');
    page.type(hrs(page, 'bar'), '8');
    submit(page);
    page.tab('periods');
    assert.match(page.text(), /Bartender 8 h · made \$496\.00 · tips \$400\.00/);
    page.tab('setup');
    page.type(page.$('#pr-bar'), '15');
    page.tab('periods');
    assert.match(page.text(), /Bartender 8 h · made \$520\.00 · tips \$400\.00/);
  } finally {
    await page.close();
  }
});

/* ---------- Pay periods editor ---------- */
test('night editor: job rows round-trip any night (several jobs, other pay, a locked night)', async () => {
  const D = today();
  const page = await boot({
    seed: jobsState('tips', (S) => {
      S.nights = [
        {
          id: 7,
          date: D,
          total: 570, // 460 tips + 6 h x 12 + 2 h x 10 + 1 h overtime x 18 (bonus is on top)
          cash: 100,
          pay: { bar: 6, prep: 2, lead: 0, ot: 1, bonus: 25 },
          barback: true,
        },
      ];
    }),
  });
  try {
    page.tab('periods');
    assert.match(page.text(), /Bartender 6 h · Prep 2 h · made/);
    const { fmtDate } = await import('../../app/js/ui/common.js');
    page.click(page.byLabel('Edit night ' + fmtDate(D)));
    const k = (x) => page.must(page.$('[data-focus-key="edit-7-' + x + '"]'), x);
    assert.equal(k('job-0').value, 'bar');
    assert.equal(k('job-1').value, 'prep');
    assert.equal(k('pay-bar').value, '6');
    assert.equal(k('pay-prep').value, '2');
    assert.equal(k('pay-ot').value, '1', 'other pay shown because the night has some');
    assert.equal(k('pay-bonus').value, '25');
    assert.equal(k('total').value, '460');
    const before = JSON.stringify(page.state().nights[0]);
    page.click(page.button('Save changes'));
    assert.equal(JSON.stringify(page.state().nights[0]), before, 'unchanged round trip');
    // change the Prep hours: the tips stay, the pay follows
    page.click(page.byLabel('Edit night ' + fmtDate(D)));
    page.type(k('pay-prep'), '3');
    page.click(page.button('Save changes'));
    const n = page.state().nights[0];
    assert.equal(n.pay.prep, 3);
    assert.equal(n.tips, 460);
    assert.equal(n.total, 460 + 72 + 30 + 18);
  } finally {
    await page.close();
  }
});

test('night editor: a locked night shows its own rates until "Recalculate with current Setup"', async () => {
  const page = await boot({
    seed: jobsState('tips', (S) => {
      S.nights = [
        {
          id: 3,
          date: '2026-01-05',
          total: 480,
          cash: null,
          pay: { bar: 8 },
          barback: true,
          snap: {
            v: 1,
            r: 0.1665,
            rf: 0.09,
            fixed: 60,
            n: 10,
            pay: [
              { id: 'bar', rate: 10, unit: 'hr', usual: 7 },
              { id: 'prep', rate: 10, unit: 'hr' },
            ],
            tipout: { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' },
          },
        },
      ];
    }),
  });
  try {
    page.tab('periods');
    const { fmtDate } = await import('../../app/js/ui/common.js');
    page.click(page.byLabel('Edit night ' + fmtDate('2026-01-05')));
    assert.match(page.text(), /\$10\.00\/h → \$80\.00/, 'its own $10 rate');
    const re = page.$('#edit-3-recalc');
    re.checked = true;
    page.change(re);
    assert.match(page.text(), /\$12\.00\/h → \$96\.00/, "today's rate once recalculating");
  } finally {
    await page.close();
  }
});

/* ---------- guided setup survives a reload ---------- */
test('guided setup keeps what was typed in the saved state (settings.guidedDraft)', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.click(page.button('Next'));
    const g = page.state().settings.guidedDraft;
    assert.equal(g.step, 1);
    assert.equal(g.profile.gross, 1500);
    assert.equal(g.profile.periodStart, '2026-09-01');
    assert.equal(g.workplaceId, 'w1');
    assert.equal(page.state().profileExample, true, 'the real profile is untouched until Finish');
  } finally {
    await page.close();
  }
});

test('guided setup: after a reload the same step comes back with the typed numbers', async () => {
  const S = storage.seedState();
  const g = storage.seedState().workplaces[0].profile;
  g.gross = 1500;
  g.periodStart = '2026-09-01';
  S.settings.guidedDraft = { step: 1, profile: g };
  const page = await boot({ seed: S });
  try {
    page.tab('setup');
    assert.match(page.text(), /Deductions/);
    assert.equal(page.$('[aria-current="step"]').textContent, '2. Deductions');
    page.click(page.button('Back'));
    assert.equal(page.$('input[placeholder="e.g. 2,000"]', page.app).value, '1500');
  } finally {
    await page.close();
  }
});

test('Tonight: a date far in the future or before 2000 is refused; $0 tips cannot carry cash', async () => {
  const page = await boot({ seed: jobsState() });
  try {
    const date = page.$('[data-focus-key="night-date"]');
    assert.equal(date.getAttribute('min'), '2000-01-01');
    page.type(box(page), '0');
    page.type(hrs(page, 'bar'), '8');
    page.type(page.$('[data-focus-key="night-cash"]'), '50');
    assert.match(page.text(), /Cash is more than the tips you entered/);
    page.type(page.$('[data-focus-key="night-cash"]'), '');
    for (const d of ['2099-01-01', '1999-12-31']) {
      page.type(date, d);
      submit(page);
      assert.match(page.text(), /Pick a date between Jan 1, 2000 and tomorrow\./);
      assert.equal(page.state().nights.length, 0, d);
    }
    page.type(date, today());
    page.type(page.$('[data-focus-key="night-cash"]'), '0');
    submit(page);
    assert.equal(page.state().nights.length, 1);
    assert.match(page.text(), /Estimated check for this pay period: \$/);
    assert.doesNotMatch(page.text(), /next check/);
  } finally {
    await page.close();
  }
});
