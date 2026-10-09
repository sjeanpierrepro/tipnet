// Tonight screen: CC tips, cash tips and hours in, estimated take-home out. Also exports the night form used by "edit night".
import {
  computeNight,
  periodTotals,
  periodIndex,
  shiftsPerPeriod,
  weeklyHours,
  payAmount,
  pinPay,
  todayISO,
  num,
  round2,
  toCents,
  fromCents,
  totalFromTips,
  tipsFromTotal,
  nightTotal,
  hasTips,
  payKind,
  jobsOf,
  otherPayOf,
  retiredUsed,
  isRetired,
  findPayPreset,
  exampleProfile,
  exampleNights,
  tipoutSetup,
  nightTipout,
  tippedOut,
  alignTicks,
  nightTicks,
  matchPeople,
  isFinal,
  nightsInPeriod,
  periodSnap,
  snapshotFor,
  snapWithPay,
} from '../math.js';
import {
  businessDate,
  cutoffFromSettings,
  negativeCheckReason,
  parseHoursInput,
  hasHoursText,
  readMoney,
  moneyTypo,
  hoursTypo,
  dateProblem,
  maxNightDate,
  MIN_NIGHT_DATE,
} from '../inputs.js';
import { lockFinished, isSetUp, isWorkplaceSetUp, findWorkplace, nightsOf } from '../storage.js';
import { countSavedNight } from './backup.js';
import {
  el,
  clear,
  field,
  moneyInput,
  money,
  money0,
  minus,
  pct,
  fmtDate,
  periodLabel,
  exampleBanner,
  exampleShown,
  setupFirstCard,
  workplaceSwitcher,
  save,
  getState,
  uid,
  debounce,
  bus,
  typoLater,
  errorTone,
} from './common.js';

// One in-progress entry per restaurant (restaurant id -> draft). They survive tab and restaurant switches, so a half-typed
// entry is never lost: switching back to a restaurant brings its own entry back. Memory only, like before.
const drafts = new Map();
let showExample = false; // before setup: "See an example first" was tapped
// With two or more establishments, where tonight was worked is picked every night: nothing is preselected, and after a
// night is saved the pick is cleared for the next one. Memory only, like the entries: it survives tab switches and
// redraws, not a reload.
let picked = null;

/** That restaurant's nights that count as history for shift averages. Example nights never do, so the first real numbers match their preview. */
const historyOf = (S, w) => (S.nightsExample ? [] : nightsOf(S, w.id));

/** The typed amount as a number; null when blank or a typo (see readMoney). */
function typedAmount(v) {
  const n = readMoney(v);
  return Number.isFinite(n) ? n : null;
}
/** The typed amount, 0 when blank or a typo (a typo never counts as a number; the screens refuse it before saving). */
export const moneyNum = (v) => typedAmount(v) ?? 0;
/** Hours typed in an hours/shifts box: null when blank or a typo. */
// unit: the box's pay unit; a Shifts box also reads "1 shift".
const unitOf = (t) => (t && t.unit === 'hr' ? 'hours' : 'shifts');
const hoursOf = (v, unit = 'hours') => (hasHoursText(v) && !hoursTypo(v, unit) ? parseHoursInput(v) : null);
/** The business date "tonight" belongs to (the Late nights rule). */
const tonightOf = (S) => businessDate(new Date(), cutoffFromSettings(S && S.settings));

/** A pay type's display name: its own name, else its preset's, else a plain fallback. */
export function payName(t, i = 1) {
  if (t && t.name) return t.name;
  const pr = t && findPayPreset(t.k);
  if (pr && pr.k !== 'other' && pr.k !== 'otherjob') return pr.name;
  return i === 0 ? 'Main job' : t && payKind(t, i) === 'job' ? 'Other job' : 'Other pay';
}
const same = (a, b) => String(a) === String(b);
const typeById = (p, id) => (p.payTypes || []).find((t) => same(t.id, id));
const fmtHrs = (h) => String(Math.round(h * 100) / 100);

/**
 * {on, list}: the tip-outs a draft is worked out with. The people: the locked night's own (d.tipoutSnap, set by
 * draftFromNight, or a finished period's snapshot on Tonight) or the restaurant's Setup. On or
 * off: the night's own while it is edited (d.tipoutOn, from draftFromNight), else the snapshot's or Setup's as it is
 * now (what a new night is saved with).
 */
export const draftSetup = (d, p) => nightTipout({ snap: d && d.tipoutSnap, tipoutOn: d && d.tipoutOn }, p);
/** The people a draft can tick as tipped out (draftSetup): [] unless tip-outs are on. */
export function draftTipouts(d, p) {
  const ts = draftSetup(d, p);
  return ts.on ? ts.list : [];
}
/** Ticked unless unticked: everyone starts ticked on a new night. */
const ticked = (d, r) => !(d.tipouts && d.tipouts[r.id] === false);
/**
 * The snapshot a night dated `date` at restaurant w is locked with as soon as it is saved: its pay period has ended and
 * already has locked nights, and lockFinishedNights gives a newcomer a copy of theirs (periodSnap). null when the period
 * hasn't ended or none of its nights is locked yet (it then locks with today's Setup, which Tonight shows anyway).
 */
export function finishedSnap(S, w, date) {
  if (S.nightsExample) return null; // the first real save clears the example nights
  const p = w.profile;
  const idx = periodIndex(p, date);
  if (!Number.isFinite(idx) || !isFinal(p, idx, todayISO())) return null;
  return periodSnap(nightsInPeriod(p, nightsOf(S, w.id), idx));
}
/** A snapshot works a night out differently from today's Setup (its rates, deductions, tip-out people...). */
function snapDiffers(snap, p) {
  const keys = ['r', 'rf', 'fixed', 'n', 'nontax', 'pay', 'tipout', 'tipouts'];
  const pick = (s) => JSON.stringify(keys.map((k) => (s[k] === undefined ? null : s[k])));
  return pick(snap) !== pick(snapshotFor(p, snap.n));
}
/**
 * Point Tonight's entry at what its date is worked out with: a finished pay period's snapshot (finishedSnap) or today's
 * Setup (null). Each choice on screen goes with the person it stands for (matchPeople: the same id, or the same barback's
 * other row); people who were not on screen keep their own earlier choice, else start ticked like on any new night.
 * Returns true when that changed (the fields are then drawn again).
 */
function useSnap(d, p, snap) {
  if ((d.tipoutSnap || null) === (snap || null)) return false;
  const was = draftTipouts(d, p);
  const next = { ...(d.tipouts || {}) };
  d.tipoutSnap = snap || null;
  matchPeople(was, draftTipouts(d, p)).forEach(([r, t]) => {
    next[t.id] = !(d.tipouts && d.tipouts[r.id] === false);
  });
  d.tipouts = next;
  return true;
}
/** "15%" / "1.25%": a tip-out percentage as typed. */
const pctText = (v) => String(Math.round(num(v) * 1000) / 1000) + '%';
/** "15% of tips", "$20 flat": what one person gets. */
export function tipoutHow(r) {
  return r.mode === 'flat' ? money(num(r.value)) + ' flat' : pctText(r.value) + ' of tips';
}

/** Drop the in-progress entry, the establishment picked and the example view (e.g. after Erase everything or Restore). */
export function resetDraft() {
  drafts.clear();
  showExample = false;
  picked = null;
}
/** The "Late nights" rule changed: re-date the in-progress entries, unless the user picked a date themselves. */
export function redateDraft(S) {
  drafts.forEach((d) => {
    if (!d.dateTouched) d.date = tonightOf(S);
  });
}
/** True when any restaurant's in-progress entry has something typed (tips or hours). */
export function hasDraftInput() {
  return Array.from(drafts.values()).some(
    (d) =>
      String(d.cc || '').trim() !== '' ||
      String(d.cash || '').trim() !== '' ||
      Object.values(d.pay || {}).some((v) => String(v || '').trim() !== '' && String(v).trim() !== '1'),
  );
}
/** A restaurant was removed: forget its entry (and the pick of it). */
export function dropDraft(id) {
  drafts.delete(id);
  if (picked === id) picked = null;
}

/**
 * An empty entry. d.cc and d.cash hold the typed CC tips and Cash tips (before tip-outs); TipNet adds the pay for the
 * jobs worked. Both have to be typed to save (0 when there were none; see entryCheck). d.rows: the jobs worked tonight,
 * in order (pay type ids); their hours/shifts live in d.pay like every other amount.
 * The first row is the main job with EMPTY hours: hours are typed every night (shift lengths vary), never pre-filled
 * or remembered. A per-shift main job starts at 1 shift. Other pay stays hidden until "+ Add other pay" (d.showOther).
 */
export function blankDraft(S, p) {
  const main = jobsOf(p)[0];
  return {
    cc: '',
    cash: '',
    pay: main && main.unit === 'shift' ? { [main.id]: '1' } : {},
    rows: main ? [main.id] : [],
    showOther: false,
    tipouts: {}, // who was tipped out tonight (recipient id -> false when unticked); everyone is ticked to start
    cashOffPayroll: !!p.cashOffPayroll, // pre-ticked from the restaurant's Setup default until tonight's box is touched
    date: tonightOf(S),
  };
}
/** Keep a draft in step with Setup (a job removed or turned into other pay since): rows hold current jobs only, never twice. */
export function syncDraft(d, p) {
  if (!d.cashOffTouched) d.cashOffPayroll = !!p.cashOffPayroll;
  const jobs = jobsOf(p, d.keep);
  const isJobId = (id) => jobs.some((t) => same(t.id, id));
  d.rows = (d.rows || []).filter((id, k, a) => isJobId(id) && a.findIndex((x) => same(x, id)) === k);
  if (!d.rows.length && jobs[0]) {
    d.rows = [jobs[0].id];
    if (jobs[0].unit === 'shift' && !hasHoursText(d.pay[jobs[0].id])) d.pay[jobs[0].id] = '1';
  }
  // a job that is not in a row is not part of tonight
  jobs.forEach((t) => {
    if (!d.rows.some((id) => same(id, t.id))) delete d.pay[t.id];
  });
  return d;
}
/**
 * A saved night as an editable draft: Cash tips = its cash, CC tips = its tips minus that cash. Its tips: the ones typed,
 * or for a night typed as one total (before v38) the part of the total above its pay (tipsFromTotal: the night's own
 * rates when it is locked). A night saved without a cash amount (cash unknown) shows Cash blank and all its tips as CC
 * tips, and its cash stays unknown unless a cash amount is typed (d.cashUnknown), so what lands on its check stays
 * unknown, as it was. Its cash typed comes out of CC tips (d.tipsWas, d.ccAuto: see the tips boxes), so the night's
 * tips stay the same and nothing is counted twice, until CC tips is changed by hand. CC tips are never shown below $0 (old data with more cash than tips). Saving with the tips and
 * hours as they were opened keeps the stored numbers exactly (see the editor in periods.js).
 */
export function draftFromNight(n, p) {
  const tipsC = toCents(tipsFromTotal(n, p));
  const cashC = n.cash == null ? 0 : toCents(num(n.cash));
  const d = {
    cc: String(fromCents(Math.max(0, tipsC - cashC))),
    cash: n.cash == null ? '' : String(n.cash),
    cashUnknown: n.cash == null,
    tipsWas: n.cash == null ? fromCents(Math.max(0, tipsC)) : undefined, // its tips, all in CC tips
    ccAuto: n.cash == null, // CC tips follows the cash typed (tips - cash) until it is changed by hand
    cashOver: cashC > Math.max(0, tipsC), // saved with more cash than tips: CC tips shows $0
    pay: {},
    rows: [],
    showOther: false,
    tipouts: {},
    tipoutSnap: n.snap || null, // a locked night ticks its own tip-out people
    keep: retiredUsed(n, p), // pay types taken out of Setup that this night has an amount for: still shown for it
    tipoutOn: nightTipout(n, p).on, // whether tip-outs were on when it was saved: Setup's switch doesn't change it
    cashOffPayroll: !!n.cashOffPayroll,
    cashOffTouched: true, // a saved night keeps its own choice, whatever Setup says now
    date: n.date,
  };
  // who was tipped out that night (an older night: everyone or nobody, from its barback choice)
  draftTipouts(d, p).forEach((r) => {
    d.tipouts[r.id] = tippedOut(n, r);
  });
  p.payTypes.forEach((t, i) => {
    const a = payAmount(n, t, i);
    if (payKind(t, i) === 'job') {
      if (a > 0) {
        d.rows.push(t.id);
        d.pay[t.id] = String(a);
      }
    } else if (a) {
      d.pay[t.id] = String(a);
      d.showOther = true;
    }
  });
  const main = p.payTypes[0];
  if (!d.rows.length && main) {
    d.rows = [main.id];
    d.pay[main.id] = String(payAmount(n, main, 0));
  }
  return d;
}
/** The typed amounts as a clean pay map (hours "7:30" = 7.5). Negative hours and typos are left out (saving refuses them). */
function draftPay(d, p) {
  const pay = {};
  Object.keys(d.pay).forEach((k) => {
    if (d.pay[k] === '' || d.pay[k] == null) return;
    const t = p && typeById(p, k);
    if (t && t.unit !== 'amt') {
      const h = hoursOf(d.pay[k], unitOf(t));
      if (h == null || h < 0) return;
      pay[k] = String(Math.round(h * 10000) / 10000);
    } else if (typedAmount(d.pay[k]) != null) pay[k] = String(typedAmount(d.pay[k]));
  });
  // The main job always has an explicit amount (0 when blank), so the math never falls back to an old "usual" amount.
  const main = p && p.payTypes && p.payTypes[0];
  if (main && pay[main.id] === undefined) pay[main.id] = '0';
  return pay;
}
/** A tips box's amount in cents: 0 when blank, null for a typo or a number below 0 (saving refuses those). */
function tipsCents(v) {
  const n = readMoney(v);
  if (n === null) return 0;
  return Number.isFinite(n) && n >= 0 ? toCents(n) : null;
}
/** True when a tips box holds a number below 0. */
const belowZero = (v) => {
  const n = readMoney(v);
  return Number.isFinite(n) && n < 0;
};
/** True when the Cash tips box has something typed (a night saved without cash keeps it unknown until then). */
const cashTyped = (d) => readMoney(d.cash) !== null;
/**
 * Draft (strings) -> night with cleaned values, for live math. tips = CC tips + Cash tips (each to the cent; a box not
 * typed yet adds nothing), cash = Cash tips, and total = the tips + the hourly/per-shift pay for the jobs worked
 * (totalFromTips), so the preview and the saved night use the same numbers. While the Cash tips box is blank the cash
 * is unknown (''): the preview shows no check amount, and only a night saved without a cash amount is saved that way
 * (d.cashUnknown; Save asks for the cash on every other night). snap: work out the pay with this locked night's rates (editing or
 * replacing it), and a job added to Setup since at its Setup rate (snapWithPay: the night is stored with it).
 */
export function liveNight(d, id, p, { snap: lockedWith } = {}) {
  const pay = draftPay(d, p);
  const snap = lockedWith ? snapWithPay(lockedWith, p, { pay }) : null;
  const cashC = tipsCents(d.cash) ?? 0;
  const cash = cashTyped(d) ? String(fromCents(cashC)) : '';
  const night = {
    id,
    date: d.date || todayISO(),
    total: '',
    cash,
    pay,
    barback: false, // anyone ticked (below), for older copies of the app
  };
  // Who was tipped out tonight (everyone ticked unless unticked). With no boxes on screen (tip-outs off) nobody is (see
  // alignNight).
  const people = draftTipouts(d, p);
  if (people.length) {
    const m = {};
    people.forEach((r) => {
      m[r.id] = ticked(d, r);
    });
    night.tipouts = m;
    night.barback = people.some((r) => m[r.id]);
  }
  night.tipoutOn = draftSetup(d, p).on; // the night keeps whether tip-outs were on, whatever Setup says later
  // "Cash tips weren't run through payroll" is about the cash typed (the box is shown once there is some)
  if (d.cashOffPayroll && cashTyped(d)) night.cashOffPayroll = true;
  night.tips = fromCents((tipsCents(d.cc) ?? 0) + cashC);
  const tot = totalFromTips(night.tips, snap ? { ...night, snap } : night, p);
  if (tot > 0) night.total = String(tot);
  return night;
}
/** What the editor compares to tell which boxes were changed (editedMoney): the tips boxes and the hours, as typed. */
export const typedNow = (d) => ({ tips: JSON.stringify([d.cc, d.cash]), pay: JSON.stringify(d.pay) });
/**
 * The money of an edited night (the night editor): out is the night to store (storedNight, with the snapshot it will be
 * locked with), n the saved night, opened = typedNow(d) when the editor opened. Changes out; returns it.
 *   - CC tips and Cash tips not changed: its tips and cash stay exactly as stored (also on a night saved with more cash
 *     than tips, which shows CC tips as $0); with the hours not changed either, its total too (a night typed as one total
 *     before v38 stays one). Hours changed: the tips stay and the total is the tips + the new pay (a night typed as one
 *     total gets its tips worked out from it first; one typed below its pay keeps its total).
 *   - Changed: tips = CC tips + Cash tips as typed, and the total is the tips + the pay at the night's rates.
 */
export function editedMoney(out, n, d, p, opened) {
  const now = typedNow(d);
  if (now.tips !== opened.tips) {
    out.total = totalFromTips(out.tips, out, p);
    return out;
  }
  out.cash = n.cash == null ? null : num(n.cash);
  if (now.pay === opened.pay) {
    out.total = num(n.total);
    if (hasTips(n)) out.tips = n.tips;
    else delete out.tips;
    return out;
  }
  const t = hasTips(n) ? n.tips : tipsFromTotal(n, p);
  if (t >= 0) {
    out.tips = round2(t);
    out.total = totalFromTips(out.tips, out, p);
  } else {
    out.total = num(n.total);
    delete out.tips;
  }
  return out;
}
/** Draft -> night to store (no snapshot; the caller keeps one). Freezes each pay type's amount (0 when not worked). */
export function storedNight(d, p, id, { snap } = {}) {
  const ln = liveNight(d, id, p, { snap });
  const pay = {};
  p.payTypes.forEach((t, i) => {
    const a = payAmount(ln, t, i);
    if (a || !isRetired(t)) pay[t.id] = a; // a pay type taken out of Setup only on a night that has an amount for it
  });
  const out = {
    id,
    date: ln.date,
    total: num(ln.total),
    cash: ln.cash === '' ? null : num(ln.cash),
    pay,
    barback: ln.barback,
  };
  if (ln.tipouts) out.tipouts = ln.tipouts;
  out.tipoutOn = ln.tipoutOn;
  if (ln.cashOffPayroll) out.cashOffPayroll = true;
  out.tips = ln.tips;
  return out;
}

/**
 * Who was tipped out on a night about to be stored (out, from storedNight), for the people it will be worked out with
 * (target: its snapshot's people when it is or stays locked, else Setup's), when the boxes on screen are someone else's:
 * Tonight's boxes are always Setup's, the editor's are the night's own until a move changes its snapshot. cur: the saved night it replaces or edits (null for a new night). See alignTicks: the choices on screen are
 * carried over to target and the rest of cur's map is kept. No boxes on screen (tip-outs switched off): a new night (or
 * the part added to one) had nobody tipped out, so everyone in target is false (a night saved
 * while tip-outs were off never becomes tipped out); an edited or replaced night keeps what it had (its map and barback),
 * so nobody's tick changes. Changes out; returns it.
 */
export function alignNight(out, d, p, cur, target) {
  const shownList = draftTipouts(d, p);
  if (!shownList.length) {
    if (!cur) {
      out.tipouts = {};
      target.forEach((r) => {
        out.tipouts[r.id] = false;
      });
      out.barback = false;
      return out;
    }
    if (cur.tipouts && typeof cur.tipouts === 'object') out.tipouts = { ...cur.tipouts };
    else delete out.tipouts;
    out.barback = !!cur.barback;
    return out;
  }
  const m = alignTicks(cur ? nightTicks(cur, target) : {}, out.tipouts || {}, shownList, target);
  out.tipouts = m;
  if (target.length) out.barback = target.some((r) => m[r.id] === true);
  return out;
}
/** The people a saved night is worked out with: its snapshot's when it is locked, else the restaurant's Setup. */
export const peopleOf = (night, p) => tipoutSetup((night && night.snap) || p).list;

/* ---------- checks shared by Tonight and the night editor ---------- */
/** Id of the first job row that is hourly with a rate and has no hours typed (0 is fine when typed), else null. */
export function missingHoursRow(p, d) {
  for (const id of d.rows || []) {
    const t = typeById(p, id);
    if (t && t.unit === 'hr' && num(t.rate) > 0 && !hasHoursText(d.pay[id])) return id;
  }
  return null;
}
/** Pay types with an amount box on screen right now: the job rows, then other pay once it is shown. */
function visibleTypes(p, d) {
  const rows = (d.rows || []).map((id) => typeById(p, id)).filter(Boolean);
  return d.showOther ? rows.concat(otherPayOf(p, d.keep)) : rows;
}
/**
 * {msg, id}: a plain message about the hours/shifts typed (and the pay type it is about), or {msg: ''}.
 * Refused: typos (unreadable text, "1.2.3"), negative numbers, more than 24 hours in one row, more than 24 hours in all.
 */
export function hoursProblem(p, d) {
  const types = visibleTypes(p, d);
  const many = types.length > 1;
  let total = 0;
  for (const t of types) {
    const v = d.pay[t.id];
    if (!hasHoursText(v)) continue;
    if (t.unit === 'amt') {
      const m = moneyTypo(v);
      if (m) return { msg: payName(t, p.payTypes.indexOf(t)) + ': ' + m, id: t.id };
      continue;
    }
    const what = t.unit === 'hr' ? 'Hours' : 'Shifts';
    const forName = many ? ' for ' + payName(t, p.payTypes.indexOf(t)) : '';
    if (hoursTypo(v, unitOf(t)))
      return {
        msg:
          what +
          forName +
          (t.unit === 'hr' ? ' should be a number, like 6 or 7:30.' : ' should be a number, like 1 or 2.'),
        id: t.id,
      };
    const h = parseHoursInput(v);
    if (h < 0) return { msg: what + ' can’t be a negative number' + forName + '.', id: t.id };
    if (t.unit !== 'hr') continue;
    if (h > 24)
      return {
        msg:
          'That is more than 24 hours in one night. Check the hours' +
          forName +
          '. Use 7:30 or 7.5 for seven and a half hours.',
        id: t.id,
      };
    if (!(t.k === 'diff' || t.diff)) total += h; // differential hours are the same hours again
  }
  if (total > 24.0001)
    return {
      msg: 'Your hours add up to more than 24 in one night. Check the hours for each job.',
      id: (d.rows || [])[0],
    };
  return { msg: '' };
}
export const NOTHING_MSG = 'Enter your tips or your hours first.';
/**
 * Something was entered for the night: tips above $0 (CC + Cash), or hours, shifts or an Other pay amount above 0 in a
 * box on screen. Such a night is saved and previewed even when it comes to $0 (hours at a job with no rate) or its
 * money is only pay on top of the total (a bonus). With nothing at all, Tonight says NOTHING_MSG.
 */
export function anythingEntered(p, d) {
  if ((tipsCents(d.cc) ?? 0) + (tipsCents(d.cash) ?? 0) > 0) return true;
  return visibleTypes(p, d).some((t) => {
    const a = t.unit === 'amt' ? typedAmount(d.pay[t.id]) : hoursOf(d.pay[t.id], unitOf(t));
    return a != null && a > 0;
  });
}
export const CC_MSG = 'Enter your credit card tips, or 0 if you had none.';
export const CASH_MSG = 'Enter your cash tips, or 0 if you had none.';
/**
 * {where: 'cc'|'cash', msg} when a tips box can't be saved (a number below 0), else null. 0 tips on a slow night with
 * hourly pay is fine.
 */
export function tipsProblem(d) {
  if (belowZero(d.cc)) return { where: 'cc', msg: 'CC tips can’t be a negative number.' };
  if (belowZero(d.cash)) return { where: 'cash', msg: 'Cash tips can’t be a negative number.' };
  return null;
}
/**
 * {where: 'cc'|'cash', msg} when a tips box is blank, else null. Both are needed (accuracy first: a forgotten box is
 * never read as $0), 0 when there were none. Only a night saved without a cash amount, opened in the night editor
 * (d.cashUnknown), may keep Cash tips blank: its cash stays unknown, as it was.
 */
export function tipsMissing(d) {
  if (readMoney(d.cc) === null) return { where: 'cc', msg: CC_MSG };
  if (!cashTyped(d) && !d.cashUnknown) return { where: 'cash', msg: CASH_MSG };
  return null;
}
/** True when an hoursProblem result is about text that isn't a number (not, say, more than 24 hours). */
function hoursTypoIn(p, d, bad) {
  const row = bad.msg && bad.id != null ? typeById(p, bad.id) : null;
  return !!row && !!(row.unit === 'amt' ? moneyTypo(d.pay[row.id]) : hoursTypo(d.pay[row.id], unitOf(row)));
}
/**
 * The first typed amount that isn't a number ("1.2.3", "12abc"), else null: {where: 'cc'|'cash'|'hours', msg, id?}.
 * The live preview shows this instead of numbers, and saving refuses it.
 */
export function typoProblem(p, d) {
  const cc = moneyTypo(d.cc);
  if (cc) return { where: 'cc', msg: cc };
  const cash = moneyTypo(d.cash);
  if (cash) return { where: 'cash', msg: cash };
  const bad = hoursProblem(p, d);
  if (hoursTypoIn(p, d, bad)) return { where: 'hours', msg: bad.msg, id: bad.id };
  return null;
}
/**
 * Everything that blocks saving, in the order the person meets it: {where: 'cc'|'cash'|'hours'|'date', msg, id?} or
 * null. CC tips and Cash tips have to be typed (tipsMissing), and something has to be entered (anythingEntered: tips,
 * hours or Other pay; the night may come to $0). today: the business date for tonight (dates may be at most one day
 * after it).
 */
export function entryCheck(p, d, { when = 'tonight', today = todayISO() } = {}) {
  const typo = typoProblem(p, d);
  if (typo) return typo;
  const tp = tipsProblem(d) || tipsMissing(d);
  if (tp) return tp;
  const miss = missingHoursRow(p, d);
  if (miss != null) return { where: 'hours', msg: 'Enter the hours you worked ' + when + '.', id: miss };
  const bad = hoursProblem(p, d);
  if (bad.msg) return { where: 'hours', msg: bad.msg, id: bad.id };
  if (!anythingEntered(p, d)) return { where: 'cc', msg: NOTHING_MSG };
  const dp = dateProblem(d.date, today);
  if (dp) return { where: 'date', msg: dp };
  return null;
}
/**
 * Combine an existing night with a new one on the same date: pay adds up by pay type (so job hours merge by job), and
 * the tips, cash and totals add up, so the merged night keeps following the current rates (a night typed as one total
 * before v38 has its tips worked out from it). A night saved without a cash amount keeps its cash unknown: the cash of
 * the part added is in its tips, but the night's cash isn't known, so what lands on its check stays unknown. Whether
 * tip-outs were on is a's (a.tipoutOn): a part entered after "I tip out" was switched changes nothing about it.
 */
export function mergeNights(a, b, p) {
  // the saved night's hours written out first (pinPay): an old night saved without them keeps its usual hours
  const pay = { ...pinPay(a, p) };
  Object.keys(b.pay).forEach((k) => {
    pay[k] = Math.round(((pay[k] || 0) + b.pay[k]) * 10000) / 10000;
  });
  const cash =
    a.cash == null || b.cash == null ? null : fromCents(toCents(num(a.cash)) + toCents(num(b.cash)));
  // A locked night's added part was worked out with its own rates already (see onto in render), so its total is used as is.
  const tb = a.snap ? num(b.total) : nightTotal(b, p);
  const out = { ...a, total: round2(nightTotal(a, p) + tb), cash, pay };
  delete out.tips;
  // Tip-outs: someone tipped out in either part was tipped out that night (b's ticks are already for a's people, see
  // alignNight). An added part with no boxes on screen (tip-outs switched off) says nothing about who was tipped out:
  // the night keeps its own choices.
  if (b.tipouts) {
    const m = {};
    const ids = new Set([...Object.keys(a.tipouts || {}), ...Object.keys(b.tipouts)]);
    ids.forEach((id) => {
      const on = (x) => (x.tipouts ? x.tipouts[id] === true : !!x.barback);
      m[id] = on(a) || on(b);
    });
    out.tipouts = m;
    out.barback = !!(a.barback || b.barback);
  }
  // cash skipped payroll only if every part of the night's cash did (a part with no cash, or $0, doesn't count)
  const offA = !!a.cashOffPayroll || !(num(a.cash) > 0),
    offB = !!b.cashOffPayroll || !(num(b.cash) > 0);
  if (cash != null && offA && offB && (a.cashOffPayroll || b.cashOffPayroll)) out.cashOffPayroll = true;
  else delete out.cashOffPayroll;
  const ta = tipsFromTotal(a, p);
  if (hasTips(b) && ta >= 0) {
    out.tips = round2(ta + b.tips);
    if (!a.snap) out.total = totalFromTips(out.tips, out, p);
  }
  // A locked night now worked at a job added to Setup since: its snapshot gets that job at its Setup rate (snapWithPay),
  // as the part added was worked out; with typed tips the total is then the tips + the pay at those rates.
  if (a.snap) {
    out.snap = snapWithPay(a.snap, p, out);
    if (out.snap !== a.snap && hasTips(out)) out.total = totalFromTips(out.tips, out, p);
  }
  return out;
}
/** "Prep 2 h · Bartender 6 h" for a saved night: the jobs worked, with the current Setup's names. */
export function jobsText(n, p) {
  return p.payTypes
    .map((t, i) => {
      if (payKind(t, i) !== 'job') return null;
      const a = payAmount(n, t, i);
      if (!(a > 0)) return null;
      return (
        payName(t, i) +
        ' ' +
        (t.unit === 'shift' ? fmtHrs(a) + (a === 1 ? ' shift' : ' shifts') : fmtHrs(a) + ' h')
      );
    })
    .filter(Boolean)
    .join(' · ');
}

/** The night's date box {input, field, today, onInput}: a typed date goes to d.date, then box.onInput() runs. */
export function dateBox(d, key = 'night') {
  const today = tonightOf(getState());
  const input = el('input', {
    type: 'date',
    value: d.date,
    min: MIN_NIGHT_DATE,
    max: maxNightDate(today),
    'data-focus-key': key + '-date',
  });
  const box = { input, field: field('Date', input), today, onInput: () => {} };
  input.addEventListener('input', () => {
    d.date = input.value || tonightOf(getState()); // cleared: the Late-nights business date, like a new night
    d.dateTouched = true;
    box.onInput();
  });
  return box;
}
/**
 * nightFields(p, d, {big, onInput, key, rateOf, date, into}) builds the entry fields bound to draft d.
 *   rateOf(t): the rate shown for pay type t (default its Setup rate; the editor passes a locked night's own rates).
 *   date, into: draw the fields again in place: into is the earlier root, date its dateBox. Everything but the date box
 *   is replaced, so a date being typed keeps its focus and what is half-typed (a box that leaves the page loses both).
 * Returns {root, dateBox, ccInput, tipsNode (the CC tips and Cash tips boxes), setCcError, setCashError, setHoursError,
 * setDateError, refresh, focusPay(id)}.
 */
export function nightFields(
  p,
  d,
  {
    big = false,
    onInput: onInputRaw = () => {},
    key = 'night',
    rateOf = (t) => num(t.rate),
    date: dateOpt = null,
    into = null,
  } = {},
) {
  syncDraft(d, p);
  // A typo (text that isn't a number) is flagged after a pause in typing or when its box is left (typoLater), so "$",
  // "7:" or "1," on the way to "$45", "7:30" or "1,250" never is, and politely (no alert). Fixing it clears it at once.
  // What Save refuses is shown at once, as an alert (showEntryProblem). Other messages (a number below 0, more than 24
  // hours) are shown at once.
  let refresh = () => {};
  const onInput = () => {
    refresh(); // also clears what Save said about the tips boxes, once anything is typed
    onInputRaw();
  };
  /** A box was left: its waiting typo message is shown now. */
  const flushTypos = () => [ccLater, cashLater, hoursLater].forEach((l) => l.flush());
  const people = draftTipouts(d, p); // the people who can be ticked tonight
  const bind = (input, get, set) => {
    input.value = get();
    input.addEventListener('input', () => {
      set(input.value);
      onInput();
    });
    input.addEventListener('blur', flushTypos);
    return input;
  };

  /* ----- CC tips and Cash tips, before tip-outs (TipNet adds the pay for the jobs worked) ----- */
  const sharedId = uid('tips-hint');
  /** One tips box: {input, node, setError(m, alert)}. alert: what Save refused (role="alert"); else a polite message. */
  const tipsBox = (label, k, hint, get, set) => {
    const input = bind(
      moneyInput({ id: uid(k), placeholder: '0', 'data-focus-key': key + '-' + k }),
      get,
      set,
    );
    const hintId = input.id + '-hint';
    const err = el('p', { class: 'field-error', hidden: true, 'aria-live': 'polite', id: input.id + '-err' });
    const base = hintId + ' ' + sharedId; // read with the box, after the error when there is one
    input.setAttribute('aria-describedby', base);
    const node = el(
      'div',
      { class: 'field' },
      el('label', { for: input.id }, label),
      big ? el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true' }, '$'), input) : input,
      el('p', { class: 'hint', id: hintId }, hint),
      err,
    );
    const setError = (m, alert = false) => {
      errorTone(err, alert && !!m);
      err.hidden = !m;
      err.textContent = m || '';
      node.toggleAttribute('data-invalid', !!m);
      if (m)
        input.setAttribute('aria-invalid', 'true'); // an empty aria-invalid reads as valid
      else input.removeAttribute('aria-invalid');
      input.setAttribute('aria-describedby', m ? err.id + ' ' + base : base);
    };
    return { input, node, setError };
  };
  // A night saved without a cash amount (the night editor): what typing its cash does to CC tips, said as it happens.
  const unknownNote = d.cashUnknown
    ? el('p', { class: 'note', 'data-focus-key': key + '-cash-unknown', 'aria-live': 'polite' })
    : null;
  const unknownText = () => {
    const was = money(num(d.tipsWas));
    if (!cashTyped(d))
      return (
        'This night was saved without a cash amount, so CC tips shows all its tips. If you enter the cash, it comes out of CC tips, so the night’s tips stay ' +
        was +
        '.'
      );
    if (!d.ccAuto)
      return 'This night was saved without a cash amount. Its tips are now CC tips + Cash tips as you typed them.';
    const c = tipsCents(d.cash);
    if (c != null && c > toCents(num(d.tipsWas)))
      return 'That is more cash than this night’s tips (' + was + '), so CC tips is $0.';
    return 'Your cash comes out of the CC tips, so the night’s tips stay ' + was + '.';
  };
  function showUnknown() {
    if (!unknownNote) return;
    const t = unknownText();
    if (unknownNote.textContent !== t) unknownNote.textContent = t;
  }
  showUnknown();
  // Someone is paid out of the cash: the Cash tips box takes all the cash, and TipNet takes their cash out.
  const fromCash = people.filter((r) => r.from !== 'payroll');
  const whoText = (r) => (r.k && r.k !== 'other' ? 'the ' + r.who.toLowerCase() : r.who);
  const cashHint = !people.length
    ? 'The cash tips you’re taking home.'
    : fromCash.length === 1
      ? 'All your cash tips, before paying ' +
        whoText(fromCash[0]) +
        '. TipNet takes ' +
        whoText(fromCash[0]) +
        '’s cash out.'
      : fromCash.length
        ? 'All your cash tips, before cash tip-outs. TipNet takes the cash tip-outs out.'
        : 'All your cash tips, before tip-outs.';
  const ccBox = tipsBox(
    'CC tips',
    'cc',
    people.length ? 'Credit card tips, before tip-outs.' : 'Your credit card tips.',
    () => d.cc,
    (v) => {
      d.cc = v;
      if (d.cashUnknown) {
        d.ccAuto = false; // changed by hand: the cash no longer moves it
        showUnknown();
      }
    },
  );
  const cashBox = tipsBox(
    'Cash tips',
    'cash',
    cashHint,
    () => d.cash,
    (v) => {
      d.cash = v;
      if (d.cashUnknown && d.ccAuto) {
        // A night saved without its cash has all its tips in CC tips: the cash typed comes out of them, so the night's
        // tips stay what they were (typing the cash on top would count it twice). A typo leaves CC tips as it was.
        const c = tipsCents(v);
        if (c != null) {
          d.cc = String(fromCents(Math.max(0, toCents(d.tipsWas) - c)));
          ccBox.input.value = d.cc;
        }
      }
      if (d.cashUnknown) showUnknown();
    },
  );
  const offCb = el('input', { type: 'checkbox', id: uid('cop'), 'data-focus-key': key + '-cashoff' });
  offCb.setAttribute('aria-describedby', offCb.id + '-hint');
  offCb.checked = !!d.cashOffPayroll;
  offCb.addEventListener('change', () => {
    d.cashOffPayroll = offCb.checked;
    d.cashOffTouched = true;
    onInput();
  });
  const offField = el(
    'div',
    { class: 'stack-sm' },
    el(
      'label',
      { class: 'check', for: offCb.id },
      offCb,
      el('span', null, 'Cash tips weren’t run through payroll tonight'),
    ),
    el(
      'p',
      { class: 'hint', id: offCb.id + '-hint' },
      'Tick this if no tax was taken out of tonight’s cash, so your check is bigger. The IRS still counts all tips as income, so TipNet shows what to set aside.',
    ),
  );
  offField.hidden = true; // only once a cash amount is typed
  const tipsNode = el(
    'div',
    { class: 'stack-sm' },
    el('div', { class: 'grid-2' }, ccBox.node, cashBox.node),
    el(
      'p',
      { class: 'hint', id: sharedId },
      'Tips only: TipNet adds the pay for the jobs below. Type 0 in a box if you had none.',
    ),
    // a night saved without a cash amount: its tips are all in CC tips until its cash is typed
    unknownNote,
    d.cashOver
      ? el(
          'p',
          { class: 'note', 'data-focus-key': key + '-cash-over' },
          'This night was saved with more cash than tips, so CC tips shows $0. Check both amounts.',
        )
      : null,
    offField,
  );
  const ccLater = typoLater((m) => ccBox.setError(m));
  const cashLater = typoLater((m) => cashBox.setError(m));
  const kids = [tipsNode];
  /* ----- who was tipped out tonight (everyone ticked to start) ----- */
  if (people.length) {
    const boxes = people.map((r) => {
      const cb = el('input', {
        type: 'checkbox',
        id: uid('to'),
        'data-focus-key': key + '-tipout-' + r.id,
      });
      cb.checked = ticked(d, r);
      cb.addEventListener('change', () => {
        d.tipouts = { ...(d.tipouts || {}), [r.id]: cb.checked };
        onInput();
      });
      return el(
        'label',
        { class: 'check check-compact', for: cb.id },
        cb,
        el('span', null, r.who, el('small', null, tipoutHow(r))),
      );
    });
    kids.push(
      el(
        'fieldset',
        { class: 'field tipouts-tonight' },
        el('legend', null, 'Tipped out tonight:'),
        el('div', { class: 'tipout-checks' }, boxes),
      ),
    );
  }

  /* ----- jobs worked tonight ----- */
  const jobs = jobsOf(p, d.keep); // a retired job only on a saved night that has hours for it (d.keep)
  const jobsHost = el('div', { class: 'stack-sm' });
  const rateLines = []; // [{t, input, line}] for the rows on screen, refreshed as hours are typed
  const rateText = (t, v) => {
    const r = rateOf(t);
    if (!(r > 0)) return 'No rate in Setup for this job, so it adds no pay.';
    const unit = t.unit === 'shift' ? '/shift' : '/h';
    const h = hoursOf(v, unitOf(t));
    return money(r) + unit + (h != null && h >= 0 ? ' → ' + money(round2(h * r)) : '');
  };
  let rootEl = null;
  const focusKey = (k) => {
    // matched by value, not by a selector built from it (an id from a restored backup may hold any character)
    const n = Array.from((rootEl || document).querySelectorAll('[data-focus-key]')).find(
      (x) => x.getAttribute('data-focus-key') === k,
    );
    if (n) n.focus();
  };
  const drawJobs = () => {
    clear(jobsHost);
    rateLines.length = 0;
    d.rows.forEach((id, r) => {
      const t = typeById(p, id);
      if (!t) return;
      const sel = el('select', { id: uid('job'), 'data-focus-key': key + '-job-' + r });
      jobs.forEach((j) => {
        const taken = d.rows.some((x, k) => k !== r && same(x, j.id));
        const o = el('option', { value: String(j.id) }, payName(j, p.payTypes.indexOf(j)));
        if (taken) o.disabled = true;
        sel.append(o);
      });
      sel.value = String(t.id);
      sel.addEventListener('change', () => {
        const nt = typeById(p, sel.value);
        if (!nt || d.rows.some((x, k) => k !== r && same(x, nt.id))) {
          sel.value = String(t.id);
          return;
        }
        const was = d.pay[t.id] == null ? '' : d.pay[t.id];
        delete d.pay[t.id];
        d.rows[r] = nt.id;
        // Hours typed stay with the row when the unit is the same; a per-shift job starts at 1 shift.
        if (nt.unit === t.unit) d.pay[nt.id] = was;
        else d.pay[nt.id] = nt.unit === 'shift' ? '1' : '';
        drawJobs();
        onInput();
        focusKey(key + '-job-' + r);
      });
      const inp = bind(
        moneyInput({ placeholder: '0', 'data-focus-key': key + '-pay-' + t.id, id: uid('hrs') }),
        () => (d.pay[t.id] == null ? '' : d.pay[t.id]),
        (v) => {
          d.pay[t.id] = v;
        },
      );
      const line = el('p', { class: 'hint job-rate', id: inp.id + '-rate' }, rateText(t, d.pay[t.id]));
      inp.setAttribute('aria-describedby', line.id); // the rate line is read with the hours field
      rateLines.push({ t, input: inp, line });
      // Only one job to pick for this row (one job in Setup, or the others are in rows above): its name as plain text,
      // with its rate, instead of a dropdown with a single choice. Read as "Job: Bartender".
      const choices = jobs.filter((j) => !d.rows.some((x, k) => k !== r && same(x, j.id)));
      const jobLabel = r === 0 ? 'Job' : 'Job ' + (r + 1);
      let jobCell;
      if (choices.length > 1) jobCell = field(jobLabel, sel);
      else {
        const rr = rateOf(t);
        jobCell = el(
          'div',
          { class: 'field' },
          el('span', { class: 'field-label', 'aria-hidden': 'true' }, jobLabel),
          el(
            'p',
            { class: 'job-fixed', 'data-focus-key': key + '-job-' + r },
            el('span', { class: 'sr-only' }, jobLabel + ': '),
            payName(t, p.payTypes.indexOf(t)),
            rr > 0
              ? el('span', { class: 'hint' }, ' · ' + money(rr) + (t.unit === 'shift' ? '/shift' : '/h'))
              : null,
          ),
        );
      }
      const cells = [jobCell, field(t.unit === 'shift' ? 'Shifts' : 'Hours', inp)];
      let rm = null;
      if (r > 0) {
        rm = el(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary btn-small',
            'aria-label': 'Remove ' + payName(t, p.payTypes.indexOf(t)),
            'data-focus-key': key + '-rm-' + r,
          },
          'Remove',
        );
        rm.addEventListener('click', () => {
          d.rows.splice(r, 1);
          delete d.pay[t.id];
          drawJobs();
          onInput();
          focusKey(key + '-add-job');
          if (!document.activeElement || document.activeElement === document.body)
            focusKey(key + '-job-' + (r - 1));
        });
      }
      jobsHost.append(
        el(
          'div',
          { class: 'job-row', role: 'group', 'aria-label': 'Job ' + (r + 1) },
          el('div', { class: 'grid-2' }, cells),
          el('div', { class: 'spread' }, line, rm),
        ),
      );
    });
    if (jobs.length > d.rows.length) {
      const add = el(
        'button',
        { type: 'button', class: 'btn btn-secondary btn-small', 'data-focus-key': key + '-add-job' },
        '+ Add another job',
      );
      add.addEventListener('click', () => {
        const next = jobs.find((j) => !d.rows.some((x) => same(x, j.id)));
        if (!next) return;
        d.rows.push(next.id);
        d.pay[next.id] = next.unit === 'shift' ? '1' : '';
        drawJobs();
        onInput();
        focusKey(key + '-pay-' + next.id);
      });
      jobsHost.append(el('div', null, add));
    }
  };
  drawJobs();
  kids.push(
    el(
      'fieldset',
      { class: 'field jobs' },
      el('legend', null, big ? 'What did you work tonight?' : 'What did you work?'),
      jobsHost,
    ),
  );

  /* ----- other pay (overtime, holiday, bonus...), hidden until asked for ----- */
  const others = otherPayOf(p, d.keep);
  const otherHost = el('div');
  const drawOther = () => {
    clear(otherHost);
    if (!others.length) return;
    if (!d.showOther) {
      const btn = el(
        'button',
        {
          type: 'button',
          class: 'btn-link',
          'data-focus-key': key + '-add-other',
          'aria-describedby': key + '-other-hint',
        },
        '+ Add other pay',
      );
      btn.addEventListener('click', () => {
        d.showOther = true;
        drawOther();
        onInput();
        focusKey(key + '-pay-' + others[0].id);
      });
      otherHost.append(
        el(
          'div',
          null,
          btn,
          el(
            'p',
            { class: 'hint', id: key + '-other-hint' },
            'Overtime, holiday hours, a bonus and the like, only when you have them.',
          ),
        ),
      );
      return;
    }
    const inputs = others.map((t) => {
      const name = payName(t, p.payTypes.indexOf(t));
      const label =
        t.unit === 'amt'
          ? [name + ' $ ', el('span', { class: 'hint' }, t.nontax ? '(no tax)' : '(on top)')]
          : name + (t.unit === 'hr' ? ' hours' : ' shifts');
      const inp = bind(
        moneyInput({ placeholder: '0', 'data-focus-key': key + '-pay-' + t.id }),
        () => (d.pay[t.id] == null ? '' : d.pay[t.id]),
        (v) => {
          d.pay[t.id] = v;
        },
      );
      const r = rateOf(t);
      return field(label, inp, {
        optional: true,
        hint: t.unit !== 'amt' && r ? money(r) + (t.unit === 'hr' ? '/h' : '/shift') : undefined,
      });
    });
    otherHost.append(
      el(
        'fieldset',
        { class: 'field' },
        el('legend', null, 'Other pay tonight'),
        el('div', { class: 'grid-2' }, inputs),
      ),
    );
  };
  drawOther();
  kids.push(otherHost);
  const hoursErr = el('p', { class: 'field-error', hidden: true, 'aria-live': 'polite', id: uid('hrs-err') });
  /**
   * The hours message, and the box it is about marked invalid and linked to it (id: its pay type, when known).
   * alert: what Save refused (role="alert"); else polite.
   */
  const setHoursError = (m, { id = m ? hoursProblem(p, d).id : null, alert = false } = {}) => {
    errorTone(hoursErr, alert && !!m);
    hoursErr.hidden = !m;
    hoursErr.textContent = m || '';
    // before the fields are put together (the first refresh) the boxes are still in kids
    const all = (sel) =>
      rootEl
        ? [...rootEl.querySelectorAll(sel)]
        : kids.flatMap((k) => (k && k.querySelectorAll ? [...k.querySelectorAll(sel)] : []));
    all('[aria-describedby~="' + hoursErr.id + '"]').forEach((x) => {
      x.removeAttribute('aria-invalid');
      const rest = (x.getAttribute('aria-describedby') || '')
        .split(' ')
        .filter((t) => t && t !== hoursErr.id)
        .join(' ');
      if (rest) x.setAttribute('aria-describedby', rest);
      else x.removeAttribute('aria-describedby');
    });
    const box = m && id != null ? all('[data-focus-key="' + key + '-pay-' + id + '"]')[0] : null;
    if (box) {
      box.setAttribute('aria-invalid', 'true');
      const was = box.getAttribute('aria-describedby');
      box.setAttribute('aria-describedby', (was ? was + ' ' : '') + hoursErr.id);
    }
  };
  kids.push(hoursErr);
  const hoursLater = typoLater((m) => setHoursError(m));

  const db = dateOpt || dateBox(d, key);
  db.onInput = onInput;
  const { input: date, field: dateField, today } = db;
  kids.push(dateField);
  /** A tips box's message: a typo (waits for a pause in typing) or a number below 0 (at once). */
  const boxMsg = (v, what) => moneyTypo(v) || (belowZero(v) ? what + ' can’t be a negative number.' : '');
  /** now: show every message at once; else typos wait for a pause in typing. */
  refresh = (now = false) => {
    ccLater(boxMsg(d.cc, 'CC tips'), now || !moneyTypo(d.cc));
    cashLater(boxMsg(d.cash, 'Cash tips'), now || !moneyTypo(d.cash));
    offField.hidden = !(cashTyped(d) && tipsCents(d.cash) != null);
    offCb.checked = !!d.cashOffPayroll;
    rateLines.forEach(({ t, line }) => {
      line.textContent = rateText(t, d.pay[t.id]);
    });
    const hp = hoursProblem(p, d);
    hoursLater(hp.msg, now || !hoursTypoIn(p, d, hp));
    dateField.setError(dateProblem(d.date, today));
  };
  // Drawn (again) with a typo in a box, e.g. back from another tab or redrawn while typing: its message waits too.
  refresh();
  if (into) {
    // drawn again in place: the date box never leaves the page
    [...into.children].forEach((c) => {
      if (c !== dateField) c.remove();
    });
    kids.forEach((k) => {
      if (k !== dateField) into.insertBefore(k, dateField);
    });
    rootEl = into;
  } else rootEl = el('div', { class: 'stack' }, kids);
  return {
    root: rootEl,
    dateBox: db,
    ccInput: ccBox.input,
    tipsNode,
    /** Save's messages (shown at once; the tips boxes and the hours as alerts). */
    setCcError: (m, alert) => {
      ccLater.cancel();
      ccBox.setError(m, alert);
    },
    setCashError: (m, alert) => {
      cashLater.cancel();
      cashBox.setError(m, alert);
    },
    setHoursError: (m, opts) => {
      hoursLater.cancel();
      setHoursError(m, opts);
    },
    setDateError: (m) => dateField.setError(m),
    refresh,
    focusPay: (id) => focusKey(key + '-pay-' + id),
    focusDate: () => date.focus(),
    focusCash: () => cashBox.input.focus(),
  };
}

/** Show an entryCheck problem on the fields at once (Save was pressed; as alerts) and move focus to it. */
export function showEntryProblem(f, prob) {
  if (prob.where === 'cc') {
    f.setCcError(prob.msg, true);
    f.ccInput.focus();
  } else if (prob.where === 'hours') {
    f.setHoursError(prob.msg, { alert: true });
    if (prob.id != null) f.focusPay(prob.id);
  } else if (prob.where === 'cash') {
    f.setCashError(prob.msg, true);
    f.focusCash();
  } else {
    f.setDateError(prob.msg);
    f.focusDate();
  }
}

function bullet(dt, dd, cls) {
  return el('div', cls ? { class: cls } : null, el('dt', null, dt), el('dd', { class: 'num' }, dd));
}

/**
 * Result card body. c = computeNight result.
 * hoursMissing: a job row still needs its hours: no numbers then (they would leave the pay out). nothing: nothing was
 * entered yet (anythingEntered), so there is nothing to work out.
 */
export function resultCard(c, w, note, hoursMissing = false, nothing = !c.total) {
  if (nothing || hoursMissing)
    return el(
      'div',
      { class: 'result' },
      el(
        'p',
        { class: 'note' },
        nothing
          ? 'Enter tonight’s tips above and your take-home appears here.'
          : 'Add tonight’s hours to see your take-home.',
      ),
    );
  const cal = w.calib.length ? w.calib[w.calib.length - 1] : null;
  const acc = cal
    ? 'Your last paycheck estimate was off by ' + Math.abs(cal.err * 100).toFixed(1) + '%.'
    : 'This is an estimate. Your real paycheck can differ; check it with “Check my accuracy” after payday.';
  const rows = [
    bullet('Made tonight', money(c.total)),
    bullet('  of which base pay', money(c.basePay)),
    bullet('  of which tips', money(c.tips)),
  ];
  if (c.extra) rows.push(bullet('Extra pay (bonus etc.)', '+' + money(c.extra)));
  if (c.nontax) rows.push(bullet('Non-taxable tonight (no tax)', '+' + money(c.nontax)));
  // one line per person tipped out tonight: "Runner (15% of tips) −$60.60"
  (c.tipouts || []).forEach((l) => {
    if (l.amount > 0) rows.push(bullet(l.who + ' (' + tipoutHow(l) + ')', minus(l.amount)));
  });
  rows.push(bullet('Taxes and % deductions (' + pct(c.r) + ')', minus(c.tax)));
  if (c.fixedPerShift) rows.push(bullet('Share of fixed deductions', minus(c.fixedPerShift)));
  if (c.nontaxPerShift)
    rows.push(bullet('Share of non-taxable earnings (no tax)', '+' + money(c.nontaxPerShift)));
  rows.push(bullet('Estimated take-home', money(c.net), 'total'));

  const kids = [
    el(
      'div',
      null,
      el('div', { class: 'hero-label' }, 'Estimated take-home tonight'),
      el('div', { class: 'hero num' }, money(c.net)),
    ),
    el('dl', { class: 'breakdown' }, rows),
  ];
  if (c.tipoutScaled)
    kids.push(
      el(
        'p',
        { class: 'note', id: 'tipout-scaled' },
        'Your tip-outs came to more than tonight’s tips, so TipNet scaled each one down to add up to your tips (' +
          money(c.tipout) +
          ').',
      ),
    );
  if (c.cashInHand != null) {
    kids.push(
      el(
        'div',
        { class: 'strip strip-2' },
        el('div', null, el('span', { class: 'label' }, 'Cash you keep'), el('b', null, money(c.cashInHand))),
        el('div', null, el('span', { class: 'label' }, 'On your check'), el('b', null, money(c.onCheck))),
      ),
    );
    const why = negativeCheckReason(c);
    if (why === 'taxes') {
      kids.push(
        el(
          'p',
          { class: 'note' },
          el('strong', null, 'Heads up: '),
          'the taxes on your cash are bigger than your card tips and base pay tonight, so this night shrinks your check.',
        ),
      );
    } else if (why === 'fixed') {
      kids.push(
        el(
          'p',
          { class: 'note' },
          el('strong', null, 'Heads up: '),
          'after your cash, what is left on the check does not cover this night’s share of your fixed deductions, so this night shrinks your check.',
        ),
      );
    } else if (!c.cashOffPayroll) {
      // Not said when tonight's cash wasn't run through payroll: then no tax on it comes out of the check.
      kids.push(
        el(
          'p',
          { class: 'hint' },
          'Taxes on cash tips usually come out of the paycheck, which is why a check can look small.',
        ),
      );
    }
  } else kids.push(el('p', { class: 'note' }, 'Add your cash amount to see what lands on your check.'));
  if (c.taxOnCashToSetAside > 0)
    kids.push(
      el(
        'p',
        { class: 'note' },
        el('strong', null, 'Set aside about ' + money(c.taxOnCashToSetAside)),
        ' for taxes on tonight’s cash (estimate).',
      ),
    );
  const tip = [acc + ' '];
  if (c.fedOnTips > 0)
    tip.push(
      'About ',
      el('strong', null, money(c.fedOnTips)),
      ' of tonight’s tax is federal income tax on tips, some of which may come back at tax time (federal “No Tax on Tips” deduction, 2025–2028). Social Security and Medicare still apply.',
    );
  kids.push(el('p', { class: 'note' }, tip));
  kids.push(
    el(
      'p',
      { class: 'hint', id: 'result-one-rate' },
      'Estimates use one tax rate from your paystub; very big or small weeks can be withheld differently. “Check my accuracy” after payday keeps it close.',
    ),
  );
  if (note) kids.push(note);
  return el('div', { class: 'result' }, kids);
}

function stripCard(S, w) {
  // WHICH period: the business date (Late nights rule), the same date Tonight's entries use: at 1 a.m. on a period's
  // first day the night still belongs to the period before. Whether it is FINISHED: the calendar date, as everywhere
  // (its nights were locked at midnight, and Pay periods shows it final), so both screens show the same amounts.
  const p = w.profile;
  const idx = periodIndex(p, tonightOf(S));
  const nights = S.nightsExample && !S.profileExample ? [] : nightsOf(S, w.id);
  const t = periodTotals(p, nights, idx, todayISO());
  // with cents, like Pay periods: rounding can't make the two disagree
  const strip = el(
    'div',
    { class: 'strip' },
    el('div', null, el('span', { class: 'label' }, 'Take-home'), el('b', null, money(t.net))),
    el('div', null, el('span', { class: 'label' }, 'Nights'), el('b', null, String(t.ns.length))),
    el(
      'div',
      null,
      el('span', { class: 'label' }, 'Per hour'),
      el('b', null, t.hrs ? money(t.net / t.hrs) : '—'),
    ),
  );
  // Not "your next check": with a payday delay the next check can belong to the previous pay period.
  const cap = t.ns.length
    ? t.allCash
      ? (t.exact ? 'This pay period’s check (' : 'Check so far this pay period (') +
        t.ns.length +
        (t.ns.length === 1 ? ' night' : ' nights') +
        '): ' +
        money(t.chk) +
        '.'
      : 'Add cash amounts to every night to preview this pay period’s check.'
    : 'No nights logged yet this period.';
  return el(
    'div',
    { class: 'stack-sm' },
    el('div', { class: 'label' }, 'This pay period · ' + periodLabel(p, idx) + (t.exact ? ' · final' : '')),
    strip,
    el('p', { class: 'hint' }, cap),
  );
}

/**
 * Before setup, "See an example first": the example paystub and the example night ($585 made: $489 tips + 8 hours at
 * $12, $210 cash), worked out with the real math. Built fresh from math.js, never from the user's state. No Save here.
 */
function exampleView() {
  const today = todayISO();
  const p = exampleProfile(today);
  const nights = exampleNights(today);
  const night = nights[2]; // $585, 8 hours, $210 cash
  const exW = { profile: p, calib: [] };
  const c = computeNight(night, p, shiftsPerPeriod(p, []).n);
  const heading = el('h2', { tabindex: '-1', id: 'example-heading' }, 'These are example numbers, not yours');
  const setUp = el('button', { type: 'button', class: 'btn', id: 'example-setup' }, 'Set up with my paystub');
  setUp.addEventListener('click', () => bus.startSetup());
  const cashC = toCents(num(night.cash));
  const typed = [
    bullet('CC tips', money(fromCents(toCents(tipsFromTotal(night, p)) - cashC))),
    bullet('Cash tips', money(fromCents(cashC))),
  ];
  return el(
    'div',
    { class: 'stack' },
    el(
      'section',
      { class: 'banner banner-example', 'aria-labelledby': 'example-heading' },
      heading,
      el(
        'p',
        null,
        'A bartender paid $12 an hour worked 8 hours and made $489 in tips, ' +
          money0(night.cash) +
          ' of it in cash' +
          (c.cashInHand != null && num(night.cash) - c.cashInHand > 0.004
            ? ', ' + money(num(night.cash) - c.cashInHand) + ' of which went to the barback'
            : '') +
          '. Here is what TipNet estimates they keep. Your own paystub gives you your own numbers.',
      ),
      setUp,
    ),
    el(
      'section',
      { class: 'card stack' },
      el('h2', { class: 'card-title' }, 'Example night'),
      el('dl', { class: 'breakdown' }, typed, bullet('Bartender hours at $12', '8')),
    ),
    el('h2', { class: 'sr-only' }, 'Example estimate'),
    resultCard(c, exW),
  );
}

/**
 * Tonight is about this establishment (picked on the "Working at:" picker). Its own entry, jobs, rates and pay period
 * come with it. It is also remembered as the one used last (settings.activeWorkplaceId), which other screens start on.
 */
function pickWorkplace(S, id) {
  picked = id;
  S.settings.activeWorkplaceId = id;
  save();
  bus.rerender();
}

export function render(root) {
  const S = getState();
  if (!isSetUp(S)) {
    // No estimate and no entry form before setup: example taxes would give a wrong take-home.
    if (showExample) root.append(el('div', { class: 'stack' }, el('h1', null, 'Tonight'), exampleView()));
    else
      root.append(
        el(
          'div',
          { class: 'stack' },
          el('h1', null, 'Tonight'),
          setupFirstCard({
            title: 'Finish setup to see your take-home',
            text: 'TipNet works out your take-home from one recent paystub. It takes about 3 minutes, and your numbers stay on this device.',
            example: () => {
              showExample = true;
              exampleShown.seen = true;
              bus.rerender();
              const h = document.getElementById('example-heading');
              if (h) h.focus();
            },
          }),
        ),
      );
    return;
  }
  showExample = false;
  const many = S.workplaces.length > 1;
  if (picked != null && !findWorkplace(S, picked)) picked = null;
  // More than one establishment: "Working at:" at the very top, nothing picked until the person picks (every night), and
  // the pick switches everything below (jobs, rates, tip-out, pay period, preview). With one there is nothing to pick.
  const w = many ? findWorkplace(S, picked) : S.workplaces[0];
  const switcher = workplaceSwitcher(S, w ? w.id : null, (id) => pickWorkplace(S, id), {
    key: 'tonight-wp',
    label: 'Working at',
  });
  if (switcher) {
    switcher.removeAttribute('aria-label');
    switcher.setAttribute('aria-labelledby', 'tonight-wp-label');
  }
  const picker = switcher
    ? el(
        'div',
        { class: 'stack-sm', id: 'tonight-picker' },
        el('span', { class: 'label', id: 'tonight-wp-label' }, 'Working at:'),
        switcher,
      )
    : null;
  if (!w) {
    // Nothing picked yet: no entry and no Save until the person picks (the "Saved" line of the night before stays here).
    root.append(
      el(
        'div',
        { class: 'stack' },
        picker,
        el('h1', null, 'Tonight'),
        exampleBanner(),
        el(
          'div',
          { class: 'card' },
          el('p', { class: 'note', id: 'tonight-pick-first' }, 'Pick where you worked tonight.'),
        ),
        el('p', { class: 'hint', role: 'status', id: 'night-saved' }),
      ),
    );
    return;
  }
  const p = w.profile;
  if (!isWorkplaceSetUp(S, w)) {
    // This restaurant was added but its setup isn't finished: no estimate here yet; the others still work.
    root.append(
      el(
        'div',
        { class: 'stack' },
        picker,
        el('h1', null, 'Tonight'),
        setupFirstCard({
          title: 'Finish setting up ' + w.name,
          text:
            'TipNet needs one recent paystub from ' +
            w.name +
            ' before it can estimate your take-home there. It takes about 3 minutes.',
        }),
      ),
    );
    return;
  }
  if (!drafts.has(w.id)) drafts.set(w.id, blankDraft(S, p));
  const d = drafts.get(w.id);
  // a date in a finished pay period whose nights are locked: worked out with that period's snapshot (see finishedSnap)
  useSnap(d, p, finishedSnap(S, w, d.date));
  const banner = exampleBanner();
  const resultHost = el('div'); // the full card is not a live region: it changes on every keystroke
  const liveSummary = el('p', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  let lastSummary = '',
    started = false;
  const announce = debounce(() => {
    liveSummary.textContent = lastSummary;
  }, 800);
  const savedMsg = el('p', { class: 'hint', role: 'status', id: 'night-saved' });
  const dupHost = el('div');
  // On a phone the full card is far below Save: a short line right under the tips box follows the typing. Not a live
  // region (the debounced summary above already speaks it).
  const quick = el('p', { class: 'quick-net', 'data-focus-key': 'night-quick-net' });

  /** The night as Save stores it (the snapshot of a finished pay period it falls in, the ticks aligned to it). */
  const nightToStore = (id) => {
    const snap = d.tipoutSnap || null;
    return alignNight(
      { ...storedNight(d, p, id, { snap }), workplaceId: w.id },
      d,
      p,
      null,
      peopleOf(snap ? { snap } : null, p),
    );
  };
  /** The saved night on this date at this restaurant that Save would ask about (none for the example nights). */
  const savedOnDate = (date) => (S.nightsExample ? null : nightsOf(S, w.id).find((n) => n.date === date));
  // A locked night keeps its own pay rates: the pay added with these tips is worked out with them too, so the base
  // pay is counted once, at the rates that night is shown with. Tonight's boxes are Setup's people; a
  // locked night is worked out with its snapshot's, so the ticks are carried over to those (alignNight).
  const onto = (night, target) => ({
    ...(target.snap ? storedNight(d, p, night.id, { snap: target.snap }) : night),
  });
  /** What "Add to that night" stores for the saved night cur. */
  const addedTo = (cur, night) =>
    mergeNights(cur, alignNight(onto(night, cur), d, p, null, peopleOf(cur, p)), p);
  /** What "Replace it" stores for the saved night cur. */
  const replacedWith = (cur, night) => {
    const made = onto(night, cur);
    return alignNight(
      {
        ...made,
        id: cur.id,
        workplaceId: w.id,
        // a locked night keeps its snapshot, with a job added to Setup since at its Setup rate (snapWithPay)
        ...(cur.snap ? { snap: snapWithPay(cur.snap, p, made) } : {}),
        ...(cur.periodStart ? { periodStart: cur.periodStart } : {}), // stays in the pay period it was moved to
      },
      d,
      p,
      cur,
      peopleOf(cur, p),
    );
  };
  /** Under the preview, when a night is already saved on this date: what each choice Save will offer comes to. */
  const dupPreview = (shifts) => {
    const cur = savedOnDate(d.date);
    if (!cur || entryCheck(p, d, { today: tonightOf(S) })) return null;
    const night = nightToStore(Date.now());
    const net = (n) => computeNight(n, p, shifts).net;
    const was = net(cur);
    const added = fromCents(toCents(net(addedTo(cur, night))) - toCents(was));
    return el(
      'p',
      { class: 'note', id: 'night-dup-preview' },
      'You already saved a night on ' +
        fmtDate(d.date) +
        (many ? ' at ' + w.name : '') +
        ' (' +
        money(was) +
        '). Add to it: ' +
        money(net(addedTo(cur, night))) +
        ' (' +
        (added < 0 ? minus(added) : '+' + money(added)) +
        '). Replace it: ' +
        money(net(replacedWith(cur, night))) +
        '. As its own night: ' +
        money(net(night)) +
        '.',
    );
  };
  const update = () => {
    // A typo (like 1.2.3) or tips below $0 show no numbers: they would be worked out from something else than what was
    // typed.
    if (typoProblem(p, d) || tipsProblem(d)) {
      clear(resultHost).append(
        el(
          'div',
          { class: 'result' },
          el('p', { class: 'note' }, 'Fix the number marked above to see your take-home.'),
        ),
      );
      lastSummary = '';
      quick.textContent = '';
      quick.hidden = true;
      started = true;
      return announce();
    }
    const hist = historyOf(S, w);
    const shifts = shiftsPerPeriod(p, hist).n;
    // the night as it will be stored: locked with a finished pay period's snapshot when its date is in one
    const snap = d.tipoutSnap || null;
    const night = liveNight(d, 'draft', p, { snap });
    if (snap) night.snap = snapWithPay(snap, p, night); // a job added to Setup since, at its rate, as locking stores it
    const c = computeNight(night, p, shifts);
    const hoursMissing = missingHoursRow(p, d) != null;
    let ot = null;
    const others = hist.filter((n) => n.id !== 'draft');
    // Overtime is counted per restaurant: each employer counts its own 40 hours. By the calendar week the hours were
    // worked (the night's date), even for a night counted in another pay period on Pay periods.
    const wk = weeklyHours(p, others.concat([night]), night.date);
    if (wk.over && c.hours > 0) {
      ot = el(
        'p',
        { class: 'note' },
        'You have logged about ' +
          Math.round(wk.hours * 10) / 10 +
          ' hours this week (Monday to Sunday)' +
          (many ? ' at ' + w.name : '') +
          '. If some were overtime, add Overtime under Other pay in Setup and log those hours with “+ Add other pay”. TipNet does not work out overtime pay for you.',
      );
    }
    // a night that comes to $0 (a job with no rate) or is only a bonus is worked out too: what matters is that
    // something was entered (anythingEntered), the rule Save uses
    const none = !anythingEntered(p, d);
    clear(resultHost).append(resultCard(c, w, ot, hoursMissing, none));
    const dupNote = none || hoursMissing ? null : dupPreview(shifts);
    if (dupNote) resultHost.append(dupNote);
    lastSummary = !none && !hoursMissing ? 'Estimated take-home ' + money(c.net) : '';
    quick.textContent = none
      ? ''
      : hoursMissing
        ? 'Add tonight’s hours to see your take-home.'
        : 'Estimated take-home: ' + money(c.net);
    quick.hidden = none;
    if (!started) {
      started = true;
      liveSummary.textContent = lastSummary;
      return;
    } // first fill is silent
    announce(); // only a short summary is announced, after typing pauses
  };
  // A date in a finished pay period whose nights are locked (finishedSnap) is worked out with that period's snapshot:
  // its tip-out people to tick and its job rates, so the preview is what will be stored. Said under the date.
  const lockedNote = el('p', { class: 'hint', id: 'night-locked-note', 'aria-live': 'polite' });
  const showLockedNote = () => {
    const t =
      d.tipoutSnap && snapDiffers(d.tipoutSnap, p)
        ? 'This date is in a finished pay period (' +
          periodLabel(p, periodIndex(p, d.date)) +
          '), so it’s worked out with the Setup that period was saved with.'
        : '';
    lockedNote.hidden = !t;
    if (lockedNote.textContent !== t) lockedNote.textContent = t;
  };
  let shownDate = d.date;
  const fieldOpts = {
    big: true,
    rateOf: (t) => {
      const s = d.tipoutSnap && (d.tipoutSnap.pay || []).find((x) => same(x.id, t.id));
      return s ? num(s.rate) : num(t.rate);
    },
    onInput: () => {
      savedMsg.textContent = '';
      clear(dupHost);
      if (d.date !== shownDate) {
        shownDate = d.date;
        syncSnap();
      }
      update();
    },
  };
  let fields = nightFields(p, d, fieldOpts);
  /** The date's pay period may be finished with locked nights (or not any more): its people and rates are drawn. */
  const syncSnap = () => {
    if (useSnap(d, p, finishedSnap(S, w, d.date))) {
      fields = nightFields(p, d, { ...fieldOpts, date: fields.dateBox, into: fields.root });
      fields.tipsNode.after(quick);
    }
    showLockedNote();
  };
  showLockedNote();

  const form = el(
    'form',
    { class: 'card stack', novalidate: true, 'aria-label': many ? 'Tonight at ' + w.name : null },
    fields.root,
    lockedNote,
    dupHost,
    el('button', { class: 'btn btn-block', type: 'submit' }, many ? 'Save night at ' + w.name : 'Save night'),
    savedMsg,
  );
  fields.tipsNode.after(quick);
  /**
   * verb() stores the night and returns {stored} (the night as stored), plus {was} for "Add to that night" (the take-home
   * of the night it joined, as stored before). shifts: the shift count the preview used (Setup's).
   */
  const finish = (night, shifts, verb) => {
    if (S.nightsExample) {
      S.nights = [];
      S.workplaces[0].calib = [];
      S.nightsExample = false;
    }
    const had = S.nights.length;
    const kept = verb();
    // every 10th real night since the last backup suggests one; adding to or replacing a saved night isn't a new one
    if (S.nights.length > had) countSavedNight(S);
    lockFinished({ force: true });
    // The take-home said is what was stored, locked as it now is (a night in a finished pay period gets its snapshot
    // when saved). "Add to that night": the night's new take-home, and what the part added changed it by (stored after
    // minus stored before), never the part worked out as a night of its own (a second share of the fixed deductions,
    // a flat tip-out charged again).
    const net = computeNight(kept.stored, p, shifts).net;
    const added = kept.was == null ? null : fromCents(toCents(net) - toCents(kept.was));
    save();
    drafts.set(w.id, blankDraft(S, p));
    if (many) picked = null; // the next night: where it was worked is picked again
    bus.rerender(); // the whole tab, so the backup reminder and the TipNet Budget card stay
    const first = root.querySelector(
      many ? '#tonight-picker [role=radio][tabindex="0"]' : '[data-focus-key="night-cc"]',
    );
    if (first) first.focus();
    const m = root.querySelector('#night-saved');
    if (m)
      m.textContent =
        (many ? 'Saved to ' + w.name + ': ' : 'Saved. ') +
        money(net) +
        ' take-home for ' +
        fmtDate(night.date) +
        (added == null
          ? '.'
          : ' (' + (added < 0 ? minus(added) : '+' + money(added)) + ' from what you added).');
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    syncSnap(); // its pay period may have been locked since (at midnight, in another window)
    const prob = entryCheck(p, d, { today: tonightOf(S) });
    if (prob) return showEntryProblem(fields, prob);
    const night = nightToStore(Date.now()); // locked with the snapshot of a finished pay period (finishedSnap), else today's Setup
    // Same inputs as the preview: shift history before this night, never the example nights.
    const shifts = shiftsPerPeriod(p, historyOf(S, w)).n;
    const store = () => {
      S.nights.push(night);
      return { stored: night };
    };
    // Only this restaurant's nights: working two places on the same date is two separate nights.
    const dup = savedOnDate(night.date);
    if (!dup) return finish(night, shifts, store);
    const choose = (verb) => () => finish(night, shifts, verb);
    /**
     * Write over the saved night, looked up by id when the button is clicked (it may have been locked, merged from another
     * window or deleted since the question was shown). If it is gone, tonight is saved on its own instead.
     */
    const overDup = (make) => {
      const at = S.nights.findIndex((x) => x.id === dup.id);
      if (at < 0) return store().stored;
      return (S.nights[at] = make(S.nights[at]));
    };
    const add = el(
      'button',
      { type: 'button', class: 'btn', 'data-focus-key': 'dup-add' },
      'Add to that night',
    );
    add.addEventListener(
      'click',
      choose(() => {
        let was = null; // the night's take-home as it was stored (null: it is gone, tonight is saved on its own)
        const stored = overDup((cur) => {
          was = computeNight(cur, p, shifts).net;
          return addedTo(cur, night);
        });
        return { stored, was };
      }),
    );
    const rep = el(
      'button',
      { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'dup-replace' },
      'Replace it',
    );
    rep.addEventListener(
      'click',
      choose(() => ({
        stored: overDup((cur) => replacedWith(cur, night)),
      })),
    );
    const sep = el(
      'button',
      { type: 'button', class: 'btn btn-secondary', 'data-focus-key': 'dup-separate' },
      'Save as a separate night',
    );
    sep.addEventListener('click', choose(store));
    const worked = jobsText(dup, p);
    clear(dupHost).append(
      el(
        'div',
        { class: 'note stack-sm', role: 'group', 'aria-label': 'Night already saved for this date' },
        el(
          'p',
          null,
          'You already saved ' +
            money(nightTotal(dup, p)) +
            ' (tips ' +
            money(Math.max(0, tipsFromTotal(dup, p))) +
            ')' +
            (worked ? ', ' + worked + ',' : '') +
            ' for ' +
            fmtDate(night.date) +
            (many ? ' at ' + w.name : '') +
            '. What should TipNet do with this one?',
        ),
        add,
        rep,
        sep,
      ),
    );
    add.focus();
  });

  root.append(
    el(
      'div',
      { class: 'stack' },
      picker,
      el(
        'h1',
        null,
        many ? el('span', null, 'Tonight', el('span', { class: 'sr-only' }, ' at ' + w.name)) : 'Tonight',
      ),
      banner,
      stripCard(S, w),
      form,
      liveSummary,
      el('h2', { class: 'sr-only' }, 'Your estimate for tonight'),
      resultHost,
    ),
  );
  update();
}
