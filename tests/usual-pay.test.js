// Old nights saved without their hours (pay {} or no pay: a prototype-era save, a v37 spreadsheet import without an
// Hours column) take their main job's "usual" amount. Setting their tips (the period update, "Add to that night")
// stopped that fallback, so their base pay vanished. Their hours are now written out first, as storedNight does.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';
import { mergeNights } from '../app/js/ui/tonight.js';

const today = '2026-10-08';
const state = (on = today) =>
  migrate(
    {
      schemaVersion: 3,
      profileExample: false,
      nightsExample: false,
      workplaces: [
        {
          id: 'w1',
          name: 'Bar',
          setupDone: true,
          calib: [],
          profile: {
            freq: 14,
            periodStart: '2026-09-07',
            periodEnd: '',
            shifts: 0,
            gross: 2000,
            rateOverride: null,
            deductions: [{ id: 'd1', k: 'fed', name: 'Fed', amount: 200, mode: 'pct' }],
            payTypes: [{ id: 'p1', k: 'hourly', name: 'Main rate', rate: 5, unit: 'hr', usual: 7 }],
            tipout: { on: false, mode: 'pct', value: 0, basis: 'before', from: 'cash' },
            entryMode: 'total',
          },
        },
      ],
      nights: [
        { id: 'a', date: '2026-09-10', total: 300, cash: 100, pay: {}, barback: false, workplaceId: 'w1' },
        { id: 'b', date: '2026-09-12', total: 200, cash: 50, barback: false, workplaceId: 'w1' },
      ],
      budget: {},
      settings: { theme: 'auto', lastTab: 'tonight', activeWorkplaceId: 'w1' },
    },
    { today: on },
  );
const money = (c) => [c.total, c.basePay, c.hours, c.tips, c.net];

test('the period update with Setup unchanged keeps an old night’s usual hours and base pay ($450.00, not $387.00)', () => {
  const S = state();
  const p = S.workplaces[0].profile;
  const idx = M.periodIndex(p, '2026-09-10');
  assert.equal(M.periodTotals(p, S.nights, idx, today).net, 450);
  const r = M.periodToSetup(p, S.nights, idx, today);
  assert.equal(M.periodTotals(p, r.after, idx, today).net, 450);
  r.after.forEach((n, i) => {
    const was = M.computeNight(r.before[i], p, 10);
    assert.deepEqual(money(M.computeNight(n, p, 10)), money(was), n.id);
    assert.equal(was.basePay, 35, '7 usual hours at $5');
    assert.equal(n.pay.p1, 7, 'the hours are written out');
  });
});

for (const [when, on] of [
  ['its pay period running', '2026-09-15'],
  ['its pay period finished (locked)', today],
])
  test(
    '"Add to that night" onto an old night, ' +
      when +
      ': its usual hours are kept and the part added ($300 + $30 = $330)',
    () => {
      const S = state(on);
      const p = S.workplaces[0].profile;
      const a = S.nights.find((n) => n.id === 'a');
      assert.equal(!!a.snap, on === today);
      // Tonight's part: $20 CC tips, $0 cash, 2 hours at $5
      const part = {
        id: 'x',
        date: '2026-09-10',
        total: 30,
        tips: 20,
        cash: 0,
        pay: { p1: 2 },
        barback: false,
        tipouts: {},
        tipoutOn: false,
      };
      const m = mergeNights(a, part, p);
      const c = M.computeNight(m, p, 10);
      assert.equal(m.total, 330);
      assert.equal(c.hours, 9);
      assert.equal(c.basePay, 45);
      assert.equal(c.tips, 285);
    },
  );
