// A night keeps whether tip-outs were on when it was saved (night.tipoutOn), from Tonight, the night editor and a same-date
// Add / Replace; Setup's "I tip out" switch never changes a night already logged (third v38 review: $410.75 -> $360.24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, computeNight, snapshotFor, exampleProfile } from '../../app/js/math.js';
import { money } from '../../app/js/ui/common.js';

const today = todayISO();
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const nightOf = (page, id) => page.state().nights.find((n) => n.id === id);
const net = (page, n) => computeNight(n, page.state().workplaces[0].profile, 10).net;
const seed = (on, nights = []) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    const p = S.workplaces[0].profile;
    p.periodStart = addDays(today, -3);
    p.periodEnd = addDays(today, 10);
    p.shifts = 10;
    p.tipout = { on };
    p.tipouts = [{ ...BARBACK }];
    S.nights = nights;
  });
// $500 made, 8 hours at $12, $200 cash: $404 tips ($204 CC); the barback's 15% is $60.60 ($360.24 take-home, $410.75
// without)
function enter(page, date) {
  page.type(key(page, 'night-cc'), '204');
  page.type(key(page, 'night-pay-p1'), '8');
  page.type(key(page, 'night-cash'), '200');
  if (date) page.type(key(page, 'night-date'), date);
}
async function switchTipouts(page, on) {
  page.openSetup();
  const cb = page.$('#to-on');
  cb.checked = on;
  page.change(cb);
  await page.saveSetup();
}
const savedNight = (id, on, ticks = { t1: on }) => ({
  id,
  date: addDays(today, -1),
  total: 500,
  cash: 200,
  pay: { p1: 8 },
  barback: on,
  tipouts: ticks,
  tipoutOn: on,
  workplaceId: 'w1',
});

test('a night saved while "I tip out" is off keeps no tip-out when it is switched back on (the reviewer’s $410.75)', async () => {
  const page = await boot({ seed: seed(false) });
  try {
    enter(page);
    page.click(page.button('Save night'));
    await page.settle();
    const n = page.state().nights[0];
    assert.equal(n.tipoutOn, false);
    assert.deepEqual(n.tipouts, { t1: false }, 'no boxes on screen: nobody was tipped out');
    assert.equal(n.barback, false);
    assert.equal(net(page, n), 410.75);
    await switchTipouts(page, true);
    assert.equal(net(page, page.state().nights[0]), 410.75, 'still $410.75, no $60.60 tip-out');
    page.tab('periods');
    assert.doesNotMatch(page.text(), /\$60\.60|no tip-out/, 'no tip-out taken, and none expected');
    assert.match(page.text(), /\$410\.75 take-home/);
    // a new night tonight follows the switch as it is now
    page.tab('tonight');
    enter(page, addDays(today, -2));
    page.click(page.button('Save night'));
    await page.settle();
    const n2 = page.state().nights.find((x) => x.date === addDays(today, -2));
    assert.equal(n2.tipoutOn, true);
    assert.equal(net(page, n2), 360.24);
  } finally {
    await page.close();
  }
});

test('a night saved with tip-outs on keeps its tip-out when "I tip out" is switched off', async () => {
  const page = await boot({ seed: seed(true) });
  try {
    enter(page);
    page.click(page.button('Save night'));
    await page.settle();
    assert.equal(page.state().nights[0].tipoutOn, true);
    await switchTipouts(page, false);
    assert.equal(net(page, page.state().nights[0]), 360.24);
    page.tab('periods');
    assert.match(page.text(), /\$60\.60 tip-out/);
  } finally {
    await page.close();
  }
});

test('night editor: a night saved with tip-outs off shows it, keeps it, and its estimate is what is stored', async () => {
  const page = await boot({ seed: seed(true, [savedNight('n1', false, { t1: false })]) });
  try {
    page.tab('periods');
    page.click(page.must(page.$('[data-focus-key="edit-n1-cc"]', page.app), 'Edit'));
    assert.equal(page.$('[data-focus-key="edit-n1-tipout-t1"]'), null, 'its own switch: no boxes');
    const line = page.must(page.$('#edit-n1-tipout-on'), 'switch line');
    assert.equal(line.textContent, 'Saved with “I tip out” off, so no tip-outs are taken out of this night.');
    // $50 of the cash was card tips: the tips stay $404
    page.type(key(page, 'edit-n1-cc'), '254');
    page.type(key(page, 'edit-n1-cash'), '150');
    const preview = page.text(
      page.must(page.byText('p.hint', 'Estimated take-home for this night'), 'preview'),
    );
    page.click(page.button('Save changes'));
    await page.settle();
    const n = nightOf(page, 'n1');
    assert.equal(n.tipoutOn, false);
    assert.equal(n.cash, 150);
    assert.equal(preview, 'Estimated take-home for this night: $' + net(page, n).toFixed(2) + '.');
    assert.equal(net(page, n), 410.75);
  } finally {
    await page.close();
  }
  const page2 = await boot({ seed: seed(false, [savedNight('n1', true)]) });
  try {
    page2.tab('periods');
    page2.click(page2.must(page2.$('[data-focus-key="edit-n1-cc"]', page2.app), 'Edit'));
    assert.equal(key(page2, 'edit-n1-tipout-t1').checked, true);
    assert.equal(
      page2.$('#edit-n1-tipout-on').textContent,
      'Saved with “I tip out” on; Setup has it off now.',
    );
    page2.click(page2.button('Save changes'));
    await page2.settle();
    assert.equal(nightOf(page2, 'n1').tipoutOn, true);
    assert.equal(net(page2, nightOf(page2, 'n1')), 360.24);
  } finally {
    await page2.close();
  }
});

test('night editor: no line when the night’s switch is Setup’s; "Update this pay period" takes today’s switch', async () => {
  // a locked night of a finished pay period, saved with tip-outs off; Setup has them on now
  const p = { ...exampleProfile(today), periodStart: addDays(today, -28), periodEnd: addDays(today, -15) };
  p.tipout = { on: true };
  p.tipouts = [{ ...BARBACK }];
  const locked = {
    ...savedNight('n1', false, { t1: false }),
    date: addDays(today, -26),
    snap: snapshotFor(p, 10),
  };
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.workplaces[0].profile = { ...p, freq: 14, shifts: 10 };
      S.nights = [locked, savedNight('n2', true)];
    }),
  });
  try {
    page.tab('periods');
    page.click(page.must(page.$('[data-focus-key="edit-n2-cc"]', page.app), 'Edit n2'));
    assert.equal(page.$('#edit-n2-tipout-on'), null, 'the same as Setup: nothing to say');
    page.click(page.button('Cancel'));
    page.click(page.must(page.$('[data-focus-key="edit-n1-cc"]', page.app), 'Edit n1'));
    assert.ok(page.$('#edit-n1-tipout-on'));
    assert.equal(page.$('[data-focus-key="edit-n1-tipout-t1"]'), null);
    page.click(page.button('Cancel'));
    // n1's pay period (n2's, yesterday, has ended too)
    const sec = () => page.$('[data-focus-key="edit-n1-cc"]', page.app).closest('section');
    page.click(page.button('Update this pay period to today’s Setup', sec()));
    page.click(page.button('Update pay period', sec()));
    assert.equal(nightOf(page, 'n1').tipoutOn, true, 'today’s switch');
    assert.equal(
      computeNight(nightOf(page, 'n1'), page.state().workplaces[0].profile, 10).tipout,
      0,
      'nobody ticked',
    );
    page.click(page.must(page.$('[data-focus-key="edit-n1-cc"]', page.app), 'Edit n1'));
    assert.equal(page.$('#edit-n1-tipout-on'), null, 'the same as Setup now');
    const box = key(page, 'edit-n1-tipout-t1');
    assert.equal(box.checked, false);
    box.checked = true;
    page.change(box);
    page.click(page.button('Save changes'));
    await page.settle();
    const n = nightOf(page, 'n1');
    assert.equal(n.tipoutOn, true);
    assert.equal(computeNight(n, page.state().workplaces[0].profile, 10).tipout, 60.6);
  } finally {
    await page.close();
  }
});

test('same date: Add keeps the saved night’s switch; Replace takes tonight’s', async () => {
  for (const verb of ['Add to that night', 'Replace it']) {
    // the night was saved with tip-outs on (barback ticked); they are off tonight
    const page = await boot({ seed: seed(false, [savedNight('n1', true)]) });
    try {
      const was = net(page, nightOf(page, 'n1'));
      enter(page, addDays(today, -1));
      page.click(page.button('Save night'));
      page.click(page.button(verb));
      await page.settle();
      const n = nightOf(page, 'n1');
      if (verb === 'Add to that night') {
        assert.equal(n.tipoutOn, true, verb);
        assert.equal(n.total, 1000);
        assert.equal(computeNight(n, page.state().workplaces[0].profile, 10).tipout, 121.2, verb);
        // the night's new take-home as stored, and what the part changed it by (tip-outs on, as the night has them)
        const line = page.text(page.$('#night-saved'));
        assert.ok(line.startsWith('Saved. ' + money(net(page, n)) + ' take-home for '), line);
        assert.ok(
          line.endsWith(
            '(+' + money(Math.round((net(page, n) - was) * 100) / 100) + ' from what you added).',
          ),
          line,
        );
        assert.equal(
          Math.round((net(page, n) - was) * 100) / 100,
          366.24,
          'not $410.75 (tip-outs off), nor $360.24 (a second $6 share of fixed deductions)',
        );
      } else {
        assert.equal(n.tipoutOn, false, verb);
        assert.equal(net(page, n), 410.75, verb);
        assert.match(page.text(page.$('#night-saved')), /^Saved\. \$410\.75 take-home for /);
      }
    } finally {
      await page.close();
    }
  }
});

test('a v37 tip-out switched off: ticking "I tip out" in Setup brings its $20 back; the night saved while off stays', async () => {
  const page = await boot({
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      const p = S.workplaces[0].profile;
      p.periodStart = addDays(today, -3);
      p.periodEnd = addDays(today, 10);
      p.shifts = 10;
      delete p.tipouts;
      p.tipout = { on: false, mode: 'flat', value: 20, basis: 'before', from: 'check' };
      // v37 saved every night with barback true, also while tip-outs were off
      S.nights = [{ ...savedNight('n1', true), tipouts: undefined, tipoutOn: undefined }];
    }),
  });
  try {
    await switchTipouts(page, true);
    const p = page.state().workplaces[0].profile;
    assert.deepEqual(p.tipouts, [
      { id: 't1', k: 'barback', who: 'Barback', mode: 'flat', value: 20, from: 'payroll' },
    ]);
    assert.equal(p.tipout.on, true);
    assert.equal(computeNight(nightOf(page, 'n1'), p, 10).tipout, 0, 'saved while off: still no tip-out');
    page.tab('tonight');
    enter(page);
    assert.match(page.text(page.$('.result', page.app)), /Barback \(\$20\.00 flat\)−\$20\.00/);
  } finally {
    await page.close();
  }
});
