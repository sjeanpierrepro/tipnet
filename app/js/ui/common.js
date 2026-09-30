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
    // An element with an id can be found again after a re-render, so keep keyboard focus on it (see keepFocus).
    if (props.id && !props['data-focus-key']) n.setAttribute('data-focus-key', props.id);
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
  s.value = String(value); // option values are strings, so numbers and string modes both work
  return s;
};

/* ---------- keeping keyboard focus across re-renders ---------- */
/*
 * Screens rebuild their whole tab on every change, which would drop focus to the page. keepFocus() remembers
 * which control had focus and puts it back on the matching new one. For a screen to get this:
 *   - give the control an id (el() then adds data-focus-key for you), or set data-focus-key="something-stable"
 *     yourself (use this for controls made in a loop, e.g. 'paid-' + bill.id);
 *   - controls with neither are matched by tag, position and label, which works when the list did not change.
 * If the control is gone (for example you just deleted the row it was in), focus moves to the panel heading.
 */
const labelOf = (n) => (n.getAttribute('aria-label') || n.textContent || n.value || '').trim().slice(0, 60);
export function captureFocus(root) {
  const a = document.activeElement;
  if (!a || a === document.body || a === root || !root.contains(a)) return null;
  const saved = { key: a.getAttribute('data-focus-key') || a.id || null, tag: a.tagName, label: labelOf(a) };
  saved.index = Array.from(root.querySelectorAll(a.tagName)).indexOf(a);
  try { if (typeof a.selectionStart === 'number') { saved.start = a.selectionStart; saved.end = a.selectionEnd; } } catch (e) { /* not a text field */ }
  return saved;
}
export function restoreFocus(root, saved) {
  if (!saved) return;
  let target = null;
  if (saved.key) {
    target = Array.from(root.querySelectorAll('[data-focus-key],[id]')).find((n) => (n.getAttribute('data-focus-key') || n.id) === saved.key) || null;
  }
  if (!target && saved.index >= 0) { // no stable key (or a generated id that changed): match by tag, position and label
    const c = root.querySelectorAll(saved.tag)[saved.index];
    if (c && labelOf(c) === saved.label) target = c;
  }
  if (!target || target.disabled || target.hidden) {
    target = root.querySelector('h1,h2') || root;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  }
  try { target.focus({ preventScroll: true }); } catch (e) { return; }
  try { if (saved.start != null && target === document.activeElement && typeof target.setSelectionRange === 'function') target.setSelectionRange(saved.start, saved.end); } catch (e) { /* ignore */ }
}
/** Run redraw() (which rebuilds root's contents) and keep keyboard focus where it was. */
export function keepFocus(root, redraw) {
  const saved = captureFocus(root);
  redraw();
  restoreFocus(root, saved);
}

/* ---------- toast ---------- */
export function toast(message, { undo, ms } = {}) {
  const host = document.getElementById('toast');
  if (!host) return;
  const t = el('div', { class: 'toast' }, el('span', null, message));
  let timer;
  const duration = ms || (undo ? 8000 : 3500);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); t.remove(); };
  // Stay open while the pointer is over it or something inside has keyboard focus; the clock restarts when both are gone.
  let over = false, focused = false;
  const restart = () => { clearTimeout(timer); if (!over && !focused) timer = setTimeout(close, duration); };
  t.addEventListener('pointerenter', () => { over = true; restart(); });
  t.addEventListener('pointerleave', () => { over = false; restart(); });
  t.addEventListener('mouseenter', () => { over = true; restart(); });
  t.addEventListener('mouseleave', () => { over = false; restart(); });
  t.addEventListener('focusin', () => { focused = true; restart(); });
  t.addEventListener('focusout', () => { focused = false; restart(); });
  document.addEventListener('keydown', onKey);
  if (undo) {
    t.append(el('button', { type: 'button', onclick: () => {
      close(); undo();
      // The Undo button just left the page, which would drop keyboard focus to the top. Park it on the panel heading, as a delete does.
      const ae = document.activeElement, root = document.getElementById('app');
      if (root && (!ae || ae === document.body)) { const h = root.querySelector('h1,h2') || root; if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    } }, 'Undo'));
  }
  host.append(t);
  restart();
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

/** Set to open the restore-a-backup box on the Setup screen (read and cleared there). */
export const restoreRequest = { open: false };

/* ---------- example banner (shown on Tonight, Pay periods, Setup) ---------- */
export function exampleBanner({ restore = true } = {}) {
  const S = getState();
  if (!S.profileExample && !S.nightsExample) return null;
  const text = S.profileExample
    ? 'You are looking at example numbers. Open Setup and enter your own paystub to get your real take-home.'
    : 'The nights listed are examples. Clear them before you start logging.';
  return el('div', { class: 'banner' },
    el('p', null, text),
    S.profileExample && restore ? el('button', {
      type: 'button', class: 'btn-link',
      onclick: () => { restoreRequest.open = true; bus.go('setup'); bus.rerender(); },
    }, 'Moving from another phone? Restore a backup code') : null,
    S.nightsExample ? el('button', {
      type: 'button', class: 'btn btn-secondary btn-small',
      onclick: () => { S.nights = []; S.calib = []; S.nightsExample = false; save(); bus.rerender(); toast('Example nights cleared.'); },
    }, 'Clear example nights') : null);
}
