// Money never changes on the update from v37 (the only version real people have used): 400 random v37 states, each
// worked out by v37's own math (git show 1090d93, see tests/v37.js) and by this version after loading, night by night
// and pay period by pay period. Also the other way round: a v37 page reading this version's save works out the same.
// The states mix pay schedules, locked and running pay periods (locked with an older Setup), one tip-out on or off,
// "before" or "after tip-out", % or flat, from cash or the check, typed totals or typed tips, cash or no cash, and cash
// that skipped payroll.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../app/js/math.js';
import { migrate } from '../app/js/storage.js';
import { draftFromNight, storedNight, typedNow, editedMoney } from '../app/js/ui/tonight.js';
import { loadV37, V37 } from './v37.js';

const today = '2026-10-08';
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Every night's and every pay period's money in a state, as one version (Mx) works it out. */
function money(Mx, S) {
  const out = [];
  S.workplaces.forEach((w) => {
    const p = w.profile;
    const ns = S.nights.filter((n) => n.workplaceId === w.id);
    const idx = [...new Set(ns.map((n) => Mx.nightPeriodIndex(p, n)))].sort((a, b) => a - b);
    ns.forEach((n) => {
      const c = Mx.computeNight(n, p, 10);
      // and as the screens show it: with the shift count of the night's pay period (v37: an average of past periods
      // when none was entered; this version: the count the update gave the establishment)
      const k = Mx.nightPeriodIndex(p, n);
      const shown = Mx.computeNight(n, p, Mx.shiftsPerPeriod(p, ns, today, k).n);
      out.push([
        'night',
        w.id,
        n.id,
        c.total,
        c.tips,
        c.tipout,
        c.kept,
        c.tax,
        c.net,
        c.fromCash,
        c.cashInHand,
        c.onCheck,
        shown.net,
        shown.onCheck,
      ]);
    });
    idx.forEach((i) => {
      const t = Mx.periodTotals(p, ns, i, today);
      out.push(['period', w.id, i, t.net, t.chk, t.kept, t.cash, t.setAside, t.allCash, t.exact]);
    });
  });
  return out;
}

/** A random v37 state (seeded, so every run checks the same 400). */
function makeStates(count, seed0) {
  let seed = seed0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const states = [];
  for (let k = 0; k < count; k++) {
    const nw = pick([1, 1, 2, 3]);
    const workplaces = [];
    const nights = [];
    for (let wi = 0; wi < nw; wi++) {
      const two = rnd() < 0.3; // a second job
      const p = {
        freq: pick([7, 14, 14, 15, 'semimonthly', 'monthly']),
        periodStart: pick(['2026-08-10', '2026-08-24', '2026-09-07', '2026-09-21']),
        periodEnd: '',
        shifts: pick([0, 10]),
        gross: pick([1500, 2000]),
        rateOverride: pick([null, null, 0.18]),
        deductions: [
          { id: 'd1', k: 'fed', name: 'Fed', amount: 180, mode: 'pct' },
          { id: 'd2', k: 'ss', name: 'SS', amount: 124, mode: 'pct' },
          { id: 'd4', k: 'health', name: 'Health', amount: pick([0, 60]), mode: 'fixed' },
        ],
        payTypes: [
          { id: 'p1', k: 'bartender', name: 'Bartender', rate: pick([0, 5, 12]), unit: 'hr', usual: 7 },
          ...(two ? [{ id: 'p2', k: 'event', name: 'Banquet', rate: 40, unit: 'shift', usual: 0 }] : []),
        ],
        tipout: {
          on: rnd() < 0.7,
          mode: pick(['pct', 'flat']),
          value: pick([0, 10, 15, 20, 50, 400]),
          basis: pick(['before', 'before', 'after']),
          from: pick(['cash', 'check']),
        },
        entryMode: pick(['tips', 'total']),
        cashOffPayroll: rnd() < 0.2,
      };
      const wid = 'w' + (wi + 1);
      workplaces.push({ id: wid, name: 'Place ' + (wi + 1), profile: p, calib: [], setupDone: true });
      const nn = 3 + Math.floor(rnd() * 8);
      for (let j = 0; j < nn; j++) {
        const n = {
          id: 'n' + wi + '_' + j,
          date: M.addDays('2026-08-15', Math.floor(rnd() * 54)),
          total: pick([0, 60, 120, 300, 585, 900]),
          cash: pick([null, null, 0, 100, 210, 500]),
          pay: { p1: pick([0, 5, 8]), ...(two && rnd() < 0.4 ? { p2: 1 } : {}) },
          barback: rnd() < 0.75,
          workplaceId: wid,
        };
        if (p.entryMode === 'tips' && rnd() < 0.6) n.tips = pick([0, 50, 200, 489]);
        if (n.cash != null && rnd() < 0.3) n.cashOffPayroll = true;
        if (rnd() < 0.1) n.note = 'double';
        nights.push(n);
      }
    }
    states.push({
      raw: {
        schemaVersion: 3,
        profileExample: false,
        nightsExample: false,
        workplaces,
        nights,
        budget: {},
        settings: { theme: 'auto', lastTab: 'tonight', activeWorkplaceId: 'w1' },
      },
      // Setup changes in v37 between the two loads: a new tip-out amount, the switch or before/after flipped, a raise
      change: workplaces.map(() => ({
        value: rnd() < 0.5 ? pick([5, 12, 25]) : null,
        flipOn: rnd() < 0.3,
        flipBasis: rnd() < 0.3,
        rate: rnd() < 0.3 ? pick([6, 14]) : null,
      })),
    });
  }
  return states;
}

test('400 random v37 states: the same money in v37 and after the update, and a v37 page reading it back', async (t) => {
  const v = await loadV37();
  if (!v) return t.skip('git or commit ' + V37 + ' (tipnet-v37) is not available');
  const { storage: S7, math: M7 } = v;
  let checked = 0,
    pinnedWhole = 0,
    pinnedAvg = 0;
  const bad = [];
  makeStates(400, 12345).forEach(({ raw, change }, k) => {
    // v37 loads at an earlier date (some pay periods lock with that Setup), the Setup changes, then it loads today
    const early = S7.migrate(clone(raw), { today: '2026-09-15' });
    early.workplaces.forEach((w, i) => {
      const c = change[i];
      if (c.value != null) w.profile.tipout.value = c.value;
      if (c.flipOn) w.profile.tipout.on = !w.profile.tipout.on;
      if (c.flipBasis) w.profile.tipout.basis = w.profile.tipout.basis === 'after' ? 'before' : 'after';
      if (c.rate != null) w.profile.payTypes[0].rate = c.rate;
    });
    const v37 = S7.migrate(clone(early), { today });
    const m37 = JSON.stringify(money(M7, v37));
    const v38 = migrate(clone(v37), { today });
    const m38 = JSON.stringify(money(M, v38));
    checked++;
    // no shift count entered in v37: the update gave one (a whole number, or the exact average in shiftsAvg)
    v38.workplaces.forEach((w, i) => {
      if (raw.workplaces[i].profile.shifts > 0) return;
      if (w.profile.shiftsAvg > 0) pinnedAvg++;
      else if (w.profile.shifts > 0) pinnedWhole++;
      else bad.push('state ' + k + ': no shift count after the update');
    });
    if (m38 !== m37) bad.push('state ' + k + ': v38 after the update');
    // a v37 page still open reads this version's save (and writes it back with its own rules)
    const back = S7.migrate(clone(v38), { today });
    if (JSON.stringify(money(M7, back)) !== m37) bad.push('state ' + k + ': a v37 page reading it');
    if (JSON.stringify(money(M, migrate(clone(back), { today }))) !== m37)
      bad.push('state ' + k + ': v38 after a v37 page rewrote it');
  });
  assert.equal(checked, 400);
  assert.ok(pinnedWhole > 50 && pinnedAvg > 50, pinnedWhole + ' whole, ' + pinnedAvg + ' averages');
  assert.deepEqual(bad, []);
});

/**
 * A v37 state as this version loads it (no v37 code needed: the same random states, loaded once v37's own way would
 * have; migrate reads the v37 shapes directly).
 */
const loaded = (raw, change) => {
  const S = migrate(clone(raw), { today: '2026-09-15' });
  S.workplaces.forEach((w, i) => {
    if (change[i].rate != null) w.profile.payTypes[0].rate = change[i].rate;
  });
  return migrate(clone(S), { today });
};
/** The night editor's save (periods.js build, the money part): its draft stored again, then editedMoney. */
function editorSave(n, p, edit) {
  const d = draftFromNight(n, p);
  const opened = typedNow(d);
  if (edit) edit(d);
  const out = { ...storedNight(d, p, n.id, { snap: n.snap }), workplaceId: n.workplaceId };
  if (n.snap) out.snap = n.snap;
  // who was tipped out is the night's own (alignNight keeps it; not what this test is about)
  ['tipouts', 'barback', 'tipoutOn'].forEach((k) => {
    if (k in n) out[k] = n[k];
    else delete out[k];
  });
  return editedMoney(out, n, d, p, opened);
}
const moneyOf = (c) => [c.total, c.tips, c.tipout, c.kept, c.tax, c.net, c.fromCash, c.cashInHand, c.onCheck];

test('400 random v37 states: every night opened in the night editor shows CC = tips - cash and Cash = cash, and keeps its money', () => {
  const bad = [];
  let nights = 0,
    retyped = 0;
  makeStates(400, 12345).forEach(({ raw, change }, k) => {
    const S = loaded(raw, change);
    S.nights.forEach((n) => {
      const p = S.workplaces.find((w) => w.id === n.workplaceId).profile;
      const before = moneyOf(M.computeNight(n, p, 10));
      const tipsC = M.toCents(M.tipsFromTotal(n, p));
      const cashC = n.cash == null ? 0 : M.toCents(n.cash);
      const d = draftFromNight(n, p);
      nights++;
      // what the boxes show
      if (n.cash == null ? d.cash !== '' : Number(d.cash) !== n.cash)
        bad.push(k + ' ' + n.id + ': cash shown');
      if (M.toCents(Number(d.cc)) !== Math.max(0, tipsC - cashC)) bad.push(k + ' ' + n.id + ': CC shown');
      // saved as opened (a note or the date changed): the same money, the same stored numbers
      const same = editorSave(n, p);
      if (JSON.stringify(moneyOf(M.computeNight(same, p, 10))) !== JSON.stringify(before))
        bad.push(k + ' ' + n.id + ': saved unchanged');
      if (same.total !== n.total || same.cash !== n.cash || same.tips !== n.tips)
        bad.push(k + ' ' + n.id + ': stored numbers');
      // the same amounts typed again: the same money, wherever the boxes can show the night as it is
      if (tipsC >= cashC && tipsC >= 0) {
        retyped++;
        const again = editorSave(n, p, (x) => {
          x.cc = String(x.cc);
          x.cash = x.cash + ' ';
        });
        if (JSON.stringify(moneyOf(M.computeNight(again, p, 10))) !== JSON.stringify(before))
          bad.push(k + ' ' + n.id + ': typed again');
      }
      // only the hours changed: the tips and the cash stay as they were
      const hours = editorSave(n, p, (x) => {
        x.pay[p.payTypes[0].id] = '3';
        if (!x.rows.includes(p.payTypes[0].id)) x.rows.unshift(p.payTypes[0].id);
      });
      const c = M.computeNight(hours, p, 10);
      if (hours.cash !== n.cash) bad.push(k + ' ' + n.id + ': hours changed the cash');
      if (tipsC >= 0 && M.toCents(c.tips) !== tipsC) bad.push(k + ' ' + n.id + ': hours changed the tips');
    });
  });
  assert.ok(nights > 2000, String(nights));
  assert.ok(retyped > 1000, String(retyped));
  assert.deepEqual(bad.slice(0, 10), []);
});
