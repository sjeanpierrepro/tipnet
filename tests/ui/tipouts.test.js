// Several tip-outs on screen: Setup rows (add, remove + Undo, Save), Tonight's "Tipped out tonight" boxes, the result
// lines, the Pay periods editor and the same-date Add. There is no "% of sales" and no sales box any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays } from '../../app/js/math.js';

const today = todayISO();
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'flat', value: 12.5, from: 'payroll' };
const seed = (list = [BARBACK, RUNNER], mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].profile.tipout = { on: true, basis: 'before' };
    S.workplaces[0].profile.tipouts = list.map((x) => ({ ...x }));
    if (mutate) mutate(S);
  });
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const lines = (page) =>
  page
    .$$('.result dl.breakdown > div', page.app)
    .map((d) => (d.children[0].textContent + ' ' + d.children[1].textContent).replace(/\s+/g, ' ').trim());

test('tonight: one box per person (ticked), no sales box, result lines', async () => {
  const page = await boot({ seed: seed() });
  try {
    const legend = page.byText('legend', 'Tipped out tonight:');
    assert.ok(legend, 'the group is labelled');
    const bb = key(page, 'night-tipout-t1');
    const rn = key(page, 'night-tipout-t2');
    assert.equal(bb.checked, true);
    assert.equal(rn.checked, true);
    assert.match(page.$('label[for="' + rn.id + '"]').textContent, /Runner\$12\.50 flat/);
    assert.equal(page.$('[data-focus-key="night-sales"]'), null, 'no sales box');
    assert.doesNotMatch(page.text(), /sales/i);
    page.type(key(page, 'night-total'), '585');
    page.type(key(page, 'night-pay-p1'), '8');
    page.type(key(page, 'night-cash'), '210');
    assert.ok(lines(page).includes('Barback (15% of tips) −$73.35'), lines(page).join(' | '));
    assert.ok(lines(page).includes('Runner ($12.50 flat) −$12.50'), lines(page).join(' | '));
    assert.match(page.text(), /Cash tips collected \(before paying the barback\)/);
    assert.match(page.text(), /Cash you keep\$136\.65/);
    // unticking the runner drops the line
    rn.checked = false;
    page.change(rn);
    assert.equal(
      lines(page).some((l) => l.startsWith('Runner')),
      false,
    );
    rn.checked = true;
    page.change(rn);
    page.click(page.button('Save night'));
    const n = page.state().nights[0];
    assert.deepEqual(n.tipouts, { t1: true, t2: true });
    assert.equal('sales' in n, false);
    assert.equal(n.barback, true);
  } finally {
    await page.close();
  }
});

test('tonight: unticked people are saved as such', async () => {
  const page = await boot({ seed: seed() });
  try {
    page.type(key(page, 'night-total'), '585');
    page.type(key(page, 'night-pay-p1'), '8');
    const rn = key(page, 'night-tipout-t2');
    rn.checked = false;
    page.change(rn);
    page.click(page.button('Save night'));
    const n = page.state().nights[0];
    assert.deepEqual(n.tipouts, { t1: true, t2: false });
    assert.equal('sales' in n, false);
  } finally {
    await page.close();
  }
});

test('tonight: "after tip-out" or tip-outs off shows no boxes; scaled tip-outs say so', async () => {
  const page = await boot({ seed: seed(undefined, (S) => (S.workplaces[0].profile.tipout.basis = 'after')) });
  try {
    assert.equal(page.byText('legend', 'Tipped out tonight:'), null);
  } finally {
    await page.close();
  }
  const flat = { id: 't3', k: 'kitchen', who: 'Kitchen', mode: 'flat', value: 600, from: 'payroll' };
  const p2 = await boot({ seed: seed([BARBACK, flat]) });
  try {
    p2.type(key(p2, 'night-total'), '585');
    p2.type(key(p2, 'night-pay-p1'), '8');
    assert.match(p2.text(), /Your tip-outs came to more than tonight’s tips, so TipNet scaled each one down/);
  } finally {
    await p2.close();
  }
});

test('setup: Tip-outs card rows, + Add someone, decimals, remove + Undo, Save stores the list', async () => {
  const page = await boot({ seed: seed([BARBACK]) });
  try {
    page.openSetup();
    assert.match(page.text(), /Tip-outs/);
    assert.equal(page.$('#to-on').checked, true);
    assert.equal(page.$('#tw-t1').value, 'barback');
    page.click(page.$('#to-add'));
    const rows = page.$$('#to-rows .repeat-row');
    assert.equal(rows.length, 2);
    const sel = rows[1].querySelector('select[id^="tw-"]');
    assert.equal(sel.value, 'runner', 'the next preset not used yet');
    assert.equal(page.doc.activeElement, sel);
    const id = sel.id.slice(3);
    page.type(page.$('#tv-' + id), '1.22');
    const mode = page.$('#tm-' + id);
    // two ways to tip out: a % of my tips or a flat amount a night
    assert.deepEqual(
      [...mode.options].map((o) => [o.value, o.textContent]),
      [
        ['pctTips', '% of my tips'],
        ['flat', 'Flat $ a night'],
      ],
    );
    assert.match(page.$('#tv-' + id).closest('.field').textContent, /Percent of tips/);
    const from = page.$('#tf-' + id);
    from.value = 'payroll';
    page.change(from);
    // a custom name
    page.click(page.$('#to-add'));
    const third = page.$$('#to-rows .repeat-row')[2].querySelector('select[id^="tw-"]');
    third.value = 'other';
    page.change(third);
    const tid = third.id.slice(3);
    page.type(page.must(page.$('#tn-' + tid), 'name box'), 'Sushi bar');
    page.type(page.$('#tv-' + tid), '20');
    const m3 = page.$('#tm-' + tid);
    m3.value = 'flat';
    page.change(m3);
    // remove + Undo
    page.click(page.byLabel('Remove Runner'));
    assert.equal(page.$$('#to-rows .repeat-row').length, 2);
    page.click(page.button('Undo', page.$('#toast')));
    assert.equal(page.$$('#to-rows .repeat-row').length, 3);
    assert.equal(page.state().workplaces[0].profile.tipouts.length, 1, 'nothing applied before Save');
    await page.saveSetup();
    const list = page.state().workplaces[0].profile.tipouts;
    assert.deepEqual(
      list.map((r) => [r.k, r.who, r.mode, r.value, r.from]),
      [
        ['barback', 'Barback', 'pctTips', 15, 'cash'],
        ['runner', 'Runner', 'pctTips', 1.22, 'payroll'],
        ['other', 'Sushi bar', 'flat', 20, 'cash'],
      ],
    );
  } finally {
    await page.close();
  }
});

test('setup: an empty amount keeps Save disabled with a plain reason; switching on with nobody adds one row', async () => {
  const page = await boot({
    seed: seed([], (S) => (S.workplaces[0].profile.tipout = { on: false, basis: 'before' })),
  });
  try {
    page.openSetup();
    const on = page.$('#to-on');
    on.checked = true;
    page.change(on);
    assert.equal(page.$$('#to-rows .repeat-row').length, 1);
    assert.equal(page.$('#draft-save').disabled, true);
    assert.match(
      page.$('#draft-reasons').textContent,
      /Enter how much you tip out each person, or remove them\./,
    );
    page.type(page.$('#to-rows input[id^="tv-"]'), '0.98');
    assert.equal(page.$('#draft-save').disabled, false);
    await page.saveSetup();
    const p = page.state().workplaces[0].profile;
    assert.equal(p.tipout.on, true);
    assert.equal(p.tipouts[0].value, 0.98);
  } finally {
    await page.close();
  }
});

test('pay periods editor: the night’s boxes round-trip; a same-date Add ticks who was tipped out in either part', async () => {
  const date = addDays(today, -1);
  const page = await boot({
    seed: seed(undefined, (S) => {
      S.nights = [
        {
          id: 'n1',
          date,
          total: 585,
          cash: 210,
          pay: { p1: 8 },
          barback: true,
          tipouts: { t1: false, t2: true },
          workplaceId: 'w1',
        },
      ];
    }),
  });
  try {
    page.tab('periods');
    page.click(
      page.$$('button', page.app).find((b) => /^Edit night/.test(b.getAttribute('aria-label') || '')),
    );
    const bb = key(page, 'edit-n1-tipout-t1');
    const rn = key(page, 'edit-n1-tipout-t2');
    assert.equal(bb.checked, false);
    assert.equal(rn.checked, true);
    bb.checked = true;
    page.change(bb);
    page.click(page.button('Save changes'));
    const n = page.state().nights[0];
    assert.deepEqual(n.tipouts, { t1: true, t2: true });
    // Tonight on the same date: Add puts the two together
    page.tab('tonight');
    page.type(key(page, 'night-total'), '200');
    page.type(key(page, 'night-pay-p1'), '2');
    const rt = key(page, 'night-tipout-t2');
    rt.checked = false;
    page.change(rt);
    const d = key(page, 'night-date');
    page.type(d, date);
    page.click(page.button('Save night'));
    page.click(page.button('Add to that night'));
    const merged = page.state().nights;
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].tipouts, { t1: true, t2: true });
  } finally {
    await page.close();
  }
});
