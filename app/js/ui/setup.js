// Setup screen. First-time users get a 3-step guided flow; returning users get the full editable page.
// Every change autosaves (debounced) and ends example mode for the profile.
import {
  num, summary, lengthFromDates, dayDiff, shiftsPerPeriod,
  PAY_PRESETS, DEDUCTION_PRESETS, findPayPreset, findDeductionPreset, applyPayPreset, applyDeductionPreset, fillFica,
} from '../math.js';
import { el, clear, field, moneyInput, select, numOf, money, pct, exampleBanner, toast, save, debounce, bus, getState, applyTheme } from './common.js';
import { renderImporter } from './importer.js';
import { renderBackup, renderInstall } from './backup.js';

let guidedStep = 0;
let guidedActive = false; // stays true once the guided flow starts, even after the first edit ends example mode

/** Grouped <select> for presets. */
function presetSelect(presets, current, id) {
  const s = el('select', { id });
  const groups = [];
  presets.forEach((pr) => {
    let g = groups.find((x) => x.name === pr.g);
    if (!g) { g = { name: pr.g, items: [] }; groups.push(g); }
    g.items.push(pr);
  });
  groups.forEach((g) => s.append(el('optgroup', { label: g.name }, g.items.map((pr) => el('option', { value: pr.k }, pr.name)))));
  s.value = current;
  if (s.value !== current) s.value = 'other';
  return s;
}

/* ============ context shared by the cards on one render ============ */
function makeCtx() {
  const S = getState();
  const live = [];
  const saved = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const showSaved = debounce(() => { saved.textContent = 'All changes saved on this device.'; }, 700);
  const ctx = {
    S, p: S.profile, live, saved,
    /** Call after any profile edit. resetRate: the tax rate from paystub changed, so drop the calibration adjustment. */
    touch(resetRate) {
      S.profileExample = false;
      if (resetRate) S.profile.rateOverride = null;
      saved.textContent = 'Saving…';
      save(); showSaved();
      live.forEach((f) => f());
    },
  };
  return ctx;
}

/* ============ 1. pay period + gross ============ */
function periodCard(ctx, { title = 'Pay period and gross pay' } = {}) {
  const { p } = ctx;
  const start = el('input', { type: 'date', value: p.periodStart || '' });
  const end = el('input', { type: 'date', value: p.periodEnd || '' });
  const shifts = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '—', value: p.shifts ? String(p.shifts) : '' });
  const freq = select([[7, 'Every week'], [14, 'Every two weeks'], [15, 'Twice a month'], [30, 'Once a month']], p.freq);
  const gross = moneyInput({ value: p.gross ? String(p.gross) : '' });
  const fStart = field('Pay period started', start);
  const fEnd = field('Pay period ended', end, { optional: true });
  const fShifts = field('Shifts you worked', shifts, { optional: true });
  const fFreq = field('You get paid', freq);
  const fGross = field('Gross pay', gross, { hint: 'The top-line gross pay figure, before any deductions. Not “taxable wages.”' });

  const validate = () => {
    fStart.setError(start.value ? '' : 'Pick the day your pay period started.');
    let e = '';
    if (end.value && start.value) {
      const len = dayDiff(start.value, end.value) + 1;
      if (len < 1) e = 'The end date has to be on or after the start date.';
      else if (len > 62) e = 'Pay periods are 62 days or shorter. Check the end date.';
    }
    fEnd.setError(e);
    fShifts.setError(numOf(shifts.value) < 0 ? 'Shifts can’t be negative.' : '');
    fGross.setError(numOf(gross.value) > 0 ? '' : 'Gross pay is needed to work out your tax rate.');
    freq.disabled = lengthFromDates(p);
  };
  ctx.live.push(validate);
  start.addEventListener('input', () => { if (start.value) p.periodStart = start.value; ctx.touch(false); });
  end.addEventListener('input', () => { p.periodEnd = end.value; ctx.touch(false); });
  shifts.addEventListener('input', () => { p.shifts = Math.max(0, Math.round(numOf(shifts.value))); ctx.touch(false); });
  freq.addEventListener('change', () => { p.freq = num(freq.value); ctx.touch(false); });
  gross.addEventListener('input', () => { p.gross = numOf(gross.value); ctx.touch(true); });
  validate();
  const card = el('section', { class: 'card stack' },
    el('h2', null, title),
    el('p', { class: 'note' }, 'Use one recent paystub. Enter the numbers for that pay period, not year-to-date. Your numbers stay on this device.'),
    el('div', { class: 'grid-2' }, fStart, fEnd),
    el('div', { class: 'grid-2' }, fShifts, fFreq),
    el('p', { class: 'hint' }, 'Fill in the end date, the shift count, or both. The end date keeps each night on the right paycheck. The shift count splits your fixed deductions evenly per shift. Both together give the closest estimate. If you enter an end date, the pay schedule above is worked out from your dates.'),
    fGross);
  card.validate = () => { validate(); return !!(start.value && numOf(gross.value) > 0 && !fEnd.hasAttribute('data-invalid')); };
  card.firstInvalid = () => [start, end, shifts, gross].find((i) => i.getAttribute('aria-invalid') === 'true');
  return card;
}

/* ============ 2. deductions ============ */
function dedCard(ctx) {
  const { p, S } = ctx;
  const rowsHost = el('div', { class: 'stack' });
  const summaryBox = el('div', { class: 'note', 'aria-live': 'polite' });
  const ficaErr = el('p', { class: 'field-error', hidden: true, role: 'alert' });

  const lineText = (d) => {
    if (d.mode === 'pct') return p.gross > 0 ? (num(d.amount) / p.gross * 100).toFixed(2) + '% of every dollar you make' : 'Enter gross pay to see the rate';
    return money(num(d.amount) / shiftsPerPeriod(p, S.nights).n) + ' per shift';
  };
  const drawSummary = () => {
    const s = summary(p, S.nights);
    clear(summaryBox).append(
      'Out of every ', el('b', null, '$100'), ' you make, about ', el('b', null, money(s.taxPer100)), ' goes to taxes and you keep ', el('b', null, money(s.keepPer100)), '. ',
      'Deductions that stay the same total ', el('b', null, money(s.fixed)), ' a check, or ', el('b', null, money(s.fixedPerShift)), ' per shift, based on ', s.shiftSourceText,
      s.shiftSource === 'entered' ? '' : ' (' + s.shifts.toFixed(1).replace(/\.0$/, '') + ' shifts)', '. ',
      'Pay periods run ', el('b', null, s.periodLength + ' days'), s.fromDates ? ' from your dates' : '', '.',
      s.adjusted ? el('span', { class: 'hint' }, ' Your tax rate is adjusted from your real paychecks (' + pct(s.r) + ').') : '');
  };
  const lines = new Map();
  const drawLines = () => p.deductions.forEach((d) => { const n = lines.get(d.id); if (n) n.textContent = lineText(d); });
  ctx.live.push(drawSummary, drawLines);

  const drawRows = () => {
    clear(rowsHost); lines.clear();
    if (!p.deductions.length) rowsHost.append(el('p', { class: 'hint' }, 'No deductions yet. Add one for each line on your stub.'));
    p.deductions.forEach((d) => {
      const preset = findDeductionPreset(d.k);
      const sel = presetSelect(DEDUCTION_PRESETS, d.k, 'dk-' + d.id);
      const amt = moneyInput({ value: d.amount ? String(d.amount) : '', placeholder: '0.00' });
      const mode = select([['pct', 'Changes with my pay'], ['fixed', 'Same every check']], d.mode, { id: 'dm-' + d.id });
      const line = el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' });
      lines.set(d.id, line); line.textContent = lineText(d);
      const kids = [el('div', { class: 'field', style: 'grid-column:1/-1' }, el('label', { for: sel.id }, 'Deduction'), sel)];
      if (d.k === 'other' || !preset) {
        const nm = el('input', { type: 'text', value: d.name === 'Other' ? '' : d.name, placeholder: 'e.g. Tool fee', autocomplete: 'off', id: 'dn-' + d.id });
        nm.addEventListener('input', () => { d.name = nm.value || 'Other'; ctx.touch(false); });
        kids.push(el('div', { style: 'grid-column:1/-1' }, field('Name on stub', nm)));
      }
      amt.id = 'da-' + d.id;
      const fAmt = field('Amount this check ($)', amt);
      kids.push(el('div', { class: 'grid-2', style: 'grid-column:1/-1' }, fAmt, field('This amount', mode)));
      kids.push(line);
      if (preset && preset.notes) kids.push(el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, preset.notes));
      const rm = el('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Remove ' + d.name }, 'Remove');
      kids.push(el('div', { style: 'grid-column:1/-1' }, rm));
      sel.addEventListener('change', () => {
        const i = p.deductions.indexOf(d);
        p.deductions[i] = applyDeductionPreset(d, sel.value);
        ctx.touch(true); drawRows(); const f = document.getElementById('dk-' + d.id); if (f) f.focus();
      });
      amt.addEventListener('input', () => { d.amount = numOf(amt.value); fAmt.setError(d.amount < 0 ? 'Amounts on a stub are positive numbers.' : ''); ctx.touch(true); });
      mode.addEventListener('change', () => { d.mode = mode.value; ctx.touch(true); });
      rm.addEventListener('click', () => { p.deductions = p.deductions.filter((x) => x !== d); ctx.touch(true); drawRows(); });
      rowsHost.append(el('div', { class: 'repeat-row', style: 'grid-template-columns:minmax(0,1fr)' }, kids));
    });
  };
  drawRows(); drawSummary();

  const add = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, '+ Add deduction');
  add.addEventListener('click', () => {
    const used = p.deductions.map((d) => d.k);
    const pr = DEDUCTION_PRESETS.find((x) => !used.includes(x.k)) || DEDUCTION_PRESETS[DEDUCTION_PRESETS.length - 1];
    const id = 'd' + Date.now();
    p.deductions.push({ id, k: pr.k, name: pr.name, amount: 0, mode: pr.mode });
    ctx.touch(true); drawRows();
    const f = document.getElementById('dk-' + id); if (f) f.focus();
  });
  const fica = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Fill Social Security + Medicare from gross');
  fica.addEventListener('click', () => {
    if (!(num(p.gross) > 0)) { ficaErr.hidden = false; ficaErr.textContent = 'Enter your gross pay first, then tap this again.'; return; }
    ficaErr.hidden = true;
    p.deductions = fillFica(p);
    ctx.touch(true); drawRows();
    toast('Social Security and Medicare filled in.');
  });
  return el('section', { class: 'card stack' },
    el('h2', null, 'Deductions'),
    el('p', { class: 'note' }, 'Add a row for each line in the deductions part of your stub, using the dollar amount for that pay period. Pick whether it changes with your pay, like taxes, or stays the same every check, like health insurance.'),
    rowsHost,
    el('div', { class: 'cluster' }, add, fica), ficaErr,
    summaryBox);
}

/* ============ 3. pay types ============ */
function payCard(ctx) {
  const { p } = ctx;
  const host = el('div', { class: 'stack' });
  const draw = () => {
    clear(host);
    p.payTypes.forEach((t, i) => {
      const preset = findPayPreset(t.k);
      const sel = presetSelect(PAY_PRESETS, t.k, 'pk-' + t.id);
      const nm = el('input', { type: 'text', value: t.name || '', placeholder: 'What your stub calls it', autocomplete: 'off', id: 'pn-' + t.id });
      const unit = select([['hr', 'Per hour'], ['shift', 'Per shift'], ['amt', 'Flat amount']], t.unit, { id: 'pu-' + t.id });
      const kids = [
        el('div', { style: 'grid-column:1/-1' }, field(i === 0 ? 'Main pay type' : 'Pay type', sel)),
        el('div', { style: 'grid-column:1/-1' }, field('Name', nm)),
      ];
      const grid = [];
      if (t.unit !== 'amt') {
        const rt = moneyInput({ value: t.rate ? String(t.rate) : '', placeholder: '0.00', id: 'pr-' + t.id });
        const fr = field('Rate ($)', rt);
        const us = moneyInput({ value: t.usual ? String(t.usual) : '', placeholder: '0', id: 'pq-' + t.id });
        const flabel = (i === 0 ? 'Usual per night' : 'Default per night');
        rt.addEventListener('input', () => { t.rate = numOf(rt.value); fr.setError(i === 0 && t.rate <= 0 ? 'Enter the rate from your stub.' : ''); ctx.touch(false); });
        us.addEventListener('input', () => { t.usual = numOf(us.value); ctx.touch(false); });
        if (i === 0 && !(t.rate > 0)) fr.setError('Enter the rate from your stub.');
        grid.push(fr, field(flabel, us));
      } else {
        kids.push(el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, 'You type the dollar amount on the night it applies. Flat amounts are added on top of what you made.'));
      }
      kids.push(el('div', { class: 'grid-2', style: 'grid-column:1/-1' }, field('Paid', unit), ...grid));
      if (preset && preset.notes) kids.push(el('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, preset.notes));
      if (i > 0) {
        const rm = el('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Remove ' + (t.name || 'pay type') }, 'Remove');
        rm.addEventListener('click', () => { p.payTypes = p.payTypes.filter((x) => x !== t); ctx.touch(false); draw(); });
        kids.push(el('div', { style: 'grid-column:1/-1' }, rm));
      }
      sel.addEventListener('change', () => {
        p.payTypes[i] = applyPayPreset(t, sel.value, i > 0 ? p.payTypes[0].rate : 0);
        if (i === 0 && p.payTypes[0].unit === 'amt') p.payTypes[0].unit = 'hr'; // the main type is never a flat amount
        ctx.touch(false); draw(); const f = document.getElementById('pk-' + t.id); if (f) f.focus();
      });
      nm.addEventListener('input', () => { t.name = nm.value; ctx.touch(false); });
      unit.addEventListener('change', () => { t.unit = unit.value; if (t.unit === 'amt') { t.rate = 0; t.usual = 0; } ctx.touch(false); draw(); });
      host.append(el('div', { class: 'repeat-row', style: 'grid-template-columns:minmax(0,1fr)' }, kids));
    });
  };
  draw();
  const add = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, '+ Add pay type');
  add.addEventListener('click', () => {
    const id = 'p' + Date.now();
    p.payTypes.push({ id, k: 'other', name: '', rate: 0, unit: 'hr', usual: 0 });
    ctx.touch(false); draw();
    const f = document.getElementById('pk-' + id); if (f) f.focus();
  });
  return el('section', { class: 'card stack' },
    el('h2', null, 'Rates of pay'),
    el('p', { class: 'note' }, 'Add a row for each kind of pay on your stub. The first row is your main rate and fills in on every night automatically. Hourly and per-shift pay are part of the total you enter each night. Flat amounts, like a bonus, are added on top.'),
    host, el('div', null, add));
}

/* ============ 4. tip-out ============ */
function tipoutCard(ctx) {
  const { p } = ctx;
  const to = p.tipout;
  const on = el('input', { type: 'checkbox', id: 'to-on' }); on.checked = !!to.on;
  const mode = select([['pct', 'A % of my tips'], ['flat', 'A flat $ per shift']], to.mode);
  const value = moneyInput({ value: to.value ? String(to.value) : '' });
  const basis = select([['before', 'Before tip-out'], ['after', 'After tip-out']], to.basis);
  const from = select([['cash', 'My cash'], ['check', 'Payroll']], to.from);
  const fValue = field('Amount', value);
  const fields = el('div', { class: 'stack' },
    el('div', { class: 'grid-2' }, field('Tip-out is', mode), fValue),
    el('div', { class: 'grid-2' }, field('The number I enter is', basis), field('Barback gets paid from', from)),
    el('p', { class: 'hint' }, 'The tip-out percentage applies to your tips only, never to your hourly pay.'));
  const sync = () => {
    fields.hidden = !to.on;
    fValue.querySelector('label').textContent = to.mode === 'pct' ? 'Percent of tips' : 'Dollars per shift';
    from.disabled = to.basis === 'after';
    fValue.setError(to.on && !(num(to.value) > 0) ? 'Enter the tip-out amount, or turn tip-outs off.' : '');
  };
  ctx.live.push(sync);
  on.addEventListener('change', () => { to.on = on.checked; ctx.touch(false); });
  mode.addEventListener('change', () => { to.mode = mode.value; ctx.touch(false); });
  value.addEventListener('input', () => { to.value = numOf(value.value); ctx.touch(false); });
  basis.addEventListener('change', () => { to.basis = basis.value; ctx.touch(false); });
  from.addEventListener('change', () => { to.from = from.value; ctx.touch(false); });
  sync();
  return el('section', { class: 'card stack' },
    el('h2', null, 'Barback tip-out'),
    el('label', { class: 'check', for: 'to-on' }, on, el('span', null, 'My bar has barback tip-outs', el('small', null, 'Leave unchecked if you don’t tip out a barback.'))),
    fields);
}

/* ============ theme ============ */
function themeCard(ctx) {
  const S = ctx.S;
  const cur = S.settings.theme || 'auto';
  const btns = [['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => {
    const b = el('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-pressed': String(cur === v) }, label);
    b.addEventListener('click', () => {
      S.settings.theme = v; applyTheme(v); save();
      btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    return b;
  });
  return el('section', { class: 'card stack' }, el('h2', null, 'Appearance'), el('div', { class: 'cluster', role: 'group', 'aria-label': 'Theme' }, btns));
}

const finePrint = () => el('p', { class: 'note' }, 'Social Security and Medicare apply to every tip dollar. Under the federal “No Tax on Tips” deduction (tax years 2025–2028, up to $25,000 of qualified tips), some federal income tax taken from your tips may come back at tax time, depending on your situation. Florida has no state income tax. Taxes on cash tips usually come out of the paycheck. Auto-gratuities are wages, not tips.');

/* ============ guided flow ============ */
function guided(root, ctx) {
  const S = ctx.S;
  const names = ['Pay period and gross', 'Deductions', 'Pay and tip-out'];
  const steps = el('ol', { class: 'steps', 'aria-label': 'Setup progress' }, names.map((n, i) =>
    el('li', { class: i < guidedStep ? 'done' : '', 'aria-current': i === guidedStep ? 'step' : null }, (i + 1) + '. ' + n)));
  let body, pc = null;
  if (guidedStep === 0) { pc = periodCard(ctx); body = [pc]; }
  else if (guidedStep === 1) body = [dedCard(ctx)];
  else body = [payCard(ctx), tipoutCard(ctx)];
  const back = guidedStep > 0 ? el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { guidedStep--; bus.rerender(); window.scrollTo(0, 0); } }, 'Back') : null;
  const next = el('button', { type: 'button', class: 'btn' }, guidedStep === 2 ? 'Finish setup' : 'Next');
  next.addEventListener('click', () => {
    if (pc && !pc.validate()) { const i = pc.firstInvalid(); if (i) i.focus(); return; }
    if (guidedStep < 2) { guidedStep++; bus.rerender(); window.scrollTo(0, 0); return; }
    S.settings.setupDone = true; S.profileExample = false; guidedActive = false; save();
    guidedStep = 0; bus.rerender(); bus.go('tonight'); toast('Setup saved. Enter a night to see your estimated take-home.');
  });
  const skip = el('button', { type: 'button', class: 'btn-link', onclick: () => { S.settings.setupDone = true; guidedActive = false; save(); bus.rerender(); } }, 'Skip guided setup and show everything');
  root.append(el('div', { class: 'stack' },
    exampleBanner(),
    el('h1', null, 'Set up TipNet'),
    el('p', { class: 'hint' }, 'Three short steps, using one recent paystub. You can change any of it later.'),
    steps, body, ctx.saved,
    el('div', { class: 'cluster' }, back, next), skip, finePrint()));
}

/* ============ full setup ============ */
export function render(root) {
  const ctx = makeCtx();
  const S = ctx.S;
  if (!S.settings.setupDone && (S.profileExample || guidedActive)) { guidedActive = true; guided(root, ctx); return; }
  const importHost = el('div'), installHost = el('div'), backupHost = el('div');
  renderImporter(importHost); renderInstall(installHost); renderBackup(backupHost);
  root.append(el('div', { class: 'stack' },
    exampleBanner(), el('h1', null, 'Setup'), ctx.saved,
    periodCard(ctx, { title: 'From your paystub' }), dedCard(ctx), payCard(ctx), tipoutCard(ctx),
    themeCard(ctx), importHost, installHost, backupHost, finePrint()));
}
