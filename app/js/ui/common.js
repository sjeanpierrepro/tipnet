// Shared UI helpers: formatting, DOM builder, toast, two-tap buttons, debounce, save, theme.
import { parseISO, addDays, periodRange, num } from '../math.js';
import { getState, scheduleSave, requestPersist } from '../storage.js';

export { getState };

/* ---------- formatting ---------- */
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const isZero = (n) => Math.abs(n) < 0.005;
/** "$1,234.56" (negative: "−$12.30"). */
export const money = (n) => { n = num(n); return (n < 0 && !isZero(n) ? '−' : '') + usd.format(Math.abs(isZero(n) ? 0 : n)); };
/** Whole dollars. */
export const money0 = (n) => { n = num(n); return (n < 0 && Math.round(n) !== 0 ? '−' : '') + usd0.format(Math.abs(n)); };
/** Minus sign for breakdown rows: "−$5.00". */
export const minus = (n) => '−' + money(Math.abs(n));
export const pct = (r, d = 1) => (r * 100).toFixed(d) + '%';
const dfmt = (opts) => (iso) => new Date(parseISO(iso)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
/** "Sat, Sep 26" */
export const fmtDate = dfmt({ weekday: 'short', month: 'short', day: 'numeric' });
/** "Sep 26" */
export const fmtShort = dfmt({ month: 'short', day: 'numeric' });
export const periodLabel = (p, idx) => { const r = periodRange(p, idx); return fmtShort(r.start) + ' – ' + fmtShort(r.end); };
export { addDays };

/** Keep only characters that make up a number, so "$1,200.50" reads as 1200.50. */
export const clean = (v) => String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
export const numOf = (v) => num(clean(v));

/* ---------- DOM ---------- */
export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
export const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
let uidN = 0;
export const uid = (p = 'f') => p + (++uidN);

/** Labelled field. input: an element. Returns the .field div with .setError(msg). */
export function field(label, input, { hint, optional } = {}) {
  if (!input.id) input.id = uid();
  const err = el('p', { class: 'field-error', id: input.id + '-err', hidden: true });
  const lab = el('label', { for: input.id }, label, optional ? el('span', { class: 'hint' }, ' (optional)') : null);
  const kids = [lab, input];
  if (hint) kids.push(el('p', { class: 'hint', id: input.id + '-hint' }, hint));
  kids.push(err);
  const f = el('div', { class: 'field' }, kids);
  f.setError = (msg) => {
    err.hidden = !msg; err.textContent = msg || '';
    if (msg) { f.setAttribute('data-invalid', ''); input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', err.id); }
    else { f.removeAttribute('data-invalid'); input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
  };
  return f;
}
export const moneyInput = (props = {}) => el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...props });
export const select = (options, value, props = {}) => {
  const s = el('select', props, options.map(([v, t]) => el('option', { value: v }, t)));
  s.value = String(value);
  return s;
};

/* ---------- toast ---------- */
export function toast(message, { undo, ms } = {}) {
  const host = document.getElementById('toast');
  if (!host) return;
  const t = el('div', { class: 'toast' }, el('span', null, message));
  let timer;
  const close = () => { clearTimeout(timer); t.remove(); };
  if (undo) t.append(el('button', { type: 'button', onclick: () => { close(); undo(); } }, 'Undo'));
  host.append(t);
  timer = setTimeout(close, ms || (undo ? 5000 : 3500));
}

/* ---------- two-tap buttons ---------- */
/** First tap arms (label changes, data-armed), second within ms confirms. Never uses confirm(). */
export function arm(btn, { label, armedLabel, onConfirm, ms = 4000 }) {
  let timer = null;
  const reset = () => { clearTimeout(timer); timer = null; btn.removeAttribute('data-armed'); btn.textContent = label; };
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (timer) { reset(); onConfirm(); return; }
    btn.setAttribute('data-armed', 'true'); btn.textContent = armedLabel;
    timer = setTimeout(reset, ms);
  });
  btn.addEventListener('blur', () => { if (timer) reset(); });
  return btn;
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

/* ---------- app bus (set by app.js) ---------- */
export const bus = { go: () => {}, rerender: () => {}, stateReplaced: () => {} };

/* ---------- saving ---------- */
let persistAsked = false;
/** Debounced save of the cached state. Asks the browser to keep our data on the first save. */
export function save() {
  scheduleSave();
  if (!persistAsked) { persistAsked = true; requestPersist(); }
}

/* ---------- theme ---------- */
export function applyTheme(theme) {
  const root = document.documentElement;
  try {
    if (theme === 'light' || theme === 'dark') { root.setAttribute('data-theme', theme); localStorage.setItem('tipnet-theme', theme); }
    else { root.removeAttribute('data-theme'); localStorage.removeItem('tipnet-theme'); }
  } catch (e) { /* storage blocked: theme still applies for this visit */ }
}

/* ---------- install prompt (captured by app.js) ---------- */
export const install = { deferred: null, listeners: new Set() };
export function setInstallPrompt(e) { install.deferred = e; install.listeners.forEach((f) => f()); }

/* ---------- example banner (shown on Tonight, Pay periods, Setup) ---------- */
export function exampleBanner() {
  const S = getState();
  if (!S.profileExample && !S.nightsExample) return null;
  const text = S.profileExample
    ? 'You are looking at example numbers. Open Setup and enter your own paystub to get your real take-home.'
    : 'The nights listed are examples. Clear them before you start logging.';
  return el('div', { class: 'banner' },
    el('p', null, text),
    S.nightsExample ? el('button', {
      type: 'button', class: 'btn btn-secondary btn-small',
      onclick: () => { S.nights = []; S.calib = []; S.nightsExample = false; save(); bus.rerender(); toast('Example nights cleared.'); },
    }, 'Clear example nights') : null);
}
