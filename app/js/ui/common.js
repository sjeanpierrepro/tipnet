// Shared UI helpers: formatting, DOM builder, toast, two-tap buttons, debounce, save, theme.
import { parseISO, addDays, periodRange, num } from '../math.js';
import { getState, scheduleSave, requestPersist } from '../storage.js';
import { moneyTypo } from '../inputs.js';

export { getState };

/* ---------- formatting ---------- */
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const isZero = (n) => Math.abs(n) < 0.005;
/** "$1,234.56" (negative: "−$12.30"). */
export const money = (n) => {
  n = num(n);
  return (n < 0 && !isZero(n) ? '−' : '') + usd.format(Math.abs(isZero(n) ? 0 : n));
};
/** Whole dollars. */
export const money0 = (n) => {
  n = num(n);
  return (n < 0 && Math.round(n) !== 0 ? '−' : '') + usd0.format(Math.abs(n));
};
/** Minus sign for breakdown rows: "−$5.00". */
export const minus = (n) => '−' + money(Math.abs(n));
export const pct = (r, d = 1) => (r * 100).toFixed(d) + '%';
const dfmt = (opts) => (iso) =>
  new Date(parseISO(iso)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
/** "Sat, Sep 26" */
export const fmtDate = dfmt({ weekday: 'short', month: 'short', day: 'numeric' });
/** "Sep 26" */
export const fmtShort = dfmt({ month: 'short', day: 'numeric' });
export const periodLabel = (p, idx) => {
  const r = periodRange(p, idx);
  return fmtShort(r.start) + ' – ' + fmtShort(r.end);
};
export { addDays };

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
  kids.flat(Infinity).forEach((c) => {
    if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return n;
}
export const clear = (n) => {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
};
let uidN = 0;
export const uid = (p = 'f') => p + ++uidN;

/** Labelled field. input: an element. Returns the .field div with .setError(msg). */
export function field(label, input, { hint, optional, keepHint } = {}) {
  if (!input.id) input.id = uid();
  const err = el('p', { class: 'field-error', id: input.id + '-err', hidden: true });
  const lab = el(
    'label',
    { for: input.id },
    label,
    optional ? el('span', { class: 'hint' }, ' (optional)') : null,
  );
  const kids = [lab, input];
  // The hint is read with the field (aria-describedby), after the error while there is one.
  const base = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (hint) {
    // keepHint: the line is a value (a rate), not an explanation, so it never hides
    const p = el('p', { class: 'hint', id: input.id + '-hint' }, hint);
    kids.push(keepHint ? p : explain(p, typeof label === 'string' ? label : null));
    base.push(input.id + '-hint');
  }
  const describe = (ids) => {
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  };
  describe(base);
  kids.push(err);
  const f = el('div', { class: 'field' }, kids);
  f.setError = (msg) => {
    err.hidden = !msg;
    err.textContent = msg || '';
    if (msg) {
      f.setAttribute('data-invalid', '');
      input.setAttribute('aria-invalid', 'true');
      describe([err.id, ...base]);
    } else {
      f.removeAttribute('data-invalid');
      input.removeAttribute('aria-invalid');
      describe(base);
    }
  };
  return f;
}
export const moneyInput = (props = {}) =>
  el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    ...props,
  });
/* ---------- messages about what is being typed ---------- */
/** A typo message waits for this pause in typing (or for the box to be left), so "$" or "7:" is never flagged mid-typing. */
export const TYPO_PAUSE_MS = 800;
/**
 * The pace of a message about text being typed (a typo): later(msg) clears at once when msg is '' (the text was fixed),
 * and shows msg at once when one is already up (the text is still wrong) or when now is true. Otherwise nothing is shown
 * until typing pauses for TYPO_PAUSE_MS (each call starts the wait again). show(msg) draws it ('' clears).
 * later.flush(): show a waiting message now (the box was left); later.cancel(): drop it; later.up(): one is shown.
 */
export function typoLater(show, ms = TYPO_PAUSE_MS) {
  let up = false;
  let wait = '';
  const t = debounce(() => {
    const m = wait;
    wait = '';
    up = !!m;
    show(m);
  }, ms);
  const later = (m, now = false) => {
    if (m && !up && !now) {
      show(''); // an older message (e.g. Save's) is out of date once the text changes
      wait = m;
      t();
      return;
    }
    t.cancel();
    wait = '';
    up = !!m;
    show(m || '');
  };
  later.flush = () => {
    if (wait) t.flush();
  };
  later.cancel = () => {
    wait = '';
    t.cancel();
  };
  later.up = () => up;
  return later;
}
/**
 * An error line's tone: an alert (role="alert") for what Save, Add and the like refuse when pressed, else a polite
 * message (aria-live="polite") that never interrupts, like a typo flagged after a pause in typing.
 */
export function errorTone(node, alert) {
  if (alert) {
    node.removeAttribute('aria-live');
    node.setAttribute('role', 'alert');
  } else {
    node.removeAttribute('role');
    node.setAttribute('aria-live', 'polite');
  }
}
const typoPace = new WeakMap(); // box -> the typoLater of its message
/**
 * Flag a box whose text isn't a number: f.setError shows typo(text)'s message (the box gets aria-invalid and the message is
 * linked to it); fixing the text clears it at once. Only an error raised here (or shown for that typo) is cleared here.
 * now: false while the person types (watchTypo): the message then waits for a pause in typing or for the box to be left
 * (typoLater). The box is marked data-typo at once either way, so nothing applies the text meanwhile. Returns true while
 * the text is a typo, so callers can skip applying it. f: a field() or anything with setError.
 */
export function flagTypo(input, f, typo = moneyTypo, { now = true } = {}) {
  const m = typo(input.value);
  let later = typoPace.get(input);
  if (!later) {
    later = typoLater((msg) => {
      if (msg) {
        input.setAttribute('data-typo-shown', '');
        f.setError(msg);
      } else if (input.hasAttribute('data-typo-shown')) {
        input.removeAttribute('data-typo-shown');
        f.setError('');
      }
    });
    typoPace.set(input, later);
    input.addEventListener('blur', () => later.flush());
  }
  if (m) {
    input.setAttribute('data-typo', '');
    later(m, now);
    return true;
  }
  later('');
  if (input.hasAttribute('data-typo')) {
    input.removeAttribute('data-typo');
    f.setError(''); // e.g. a Save that refused the typo before its message was up
  }
  return false;
}
/** flagTypo as the person types: the message waits for a pause or for the box to be left. */
export const watchTypo = (input, f, typo) =>
  input.addEventListener('input', () => flagTypo(input, f, typo, { now: false }));
/** Error line for a box that has no field() around it: {node, setError}; put node right after the box. */
export function inlineError(input) {
  const node = el('p', { class: 'field-error', id: (input.id || (input.id = uid())) + '-err', hidden: true });
  return {
    node,
    setError(msg) {
      node.hidden = !msg;
      node.textContent = msg || '';
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', node.id);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    },
  };
}
export const select = (options, value, props = {}) => {
  const s = el(
    'select',
    props,
    options.map(([v, t]) => el('option', { value: v }, t)),
  );
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
  try {
    if (typeof a.selectionStart === 'number') {
      saved.start = a.selectionStart;
      saved.end = a.selectionEnd;
    }
  } catch (e) {
    /* not a text field */
  }
  return saved;
}
export function restoreFocus(root, saved) {
  if (!saved) return;
  let target = null;
  if (saved.key) {
    target =
      Array.from(root.querySelectorAll('[data-focus-key],[id]')).find(
        (n) => (n.getAttribute('data-focus-key') || n.id) === saved.key,
      ) || null;
  }
  if (!target && saved.index >= 0) {
    // no stable key (or a generated id that changed): match by tag, position and label
    const c = root.querySelectorAll(saved.tag)[saved.index];
    if (c && labelOf(c) === saved.label) target = c;
  }
  if (!target || target.disabled || target.hidden) {
    target = root.querySelector('h1,h2') || root;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  }
  try {
    target.focus({ preventScroll: true });
  } catch (e) {
    return;
  }
  try {
    if (
      saved.start != null &&
      target === document.activeElement &&
      typeof target.setSelectionRange === 'function'
    )
      target.setSelectionRange(saved.start, saved.end);
  } catch (e) {
    /* ignore */
  }
}
/**
 * The service worker changed (controllerchange). askedHere: Refresh was tapped in this window. offered: this window
 * knew an update was waiting. unsaved: something is typed here that is not saved yet.
 * 'reload' now; 'offer' the "Update available. Refresh" bar (another window's Refresh, with typing here); 'ignore' (first install).
 */
export function updateAction({ askedHere, offered, unsaved }) {
  if (askedHere) return 'reload';
  if (!offered) return 'ignore';
  return unsaved ? 'offer' : 'reload';
}
/* ---------- half-typed entries across a redraw caused by another window ---------- */
const edited = new WeakSet(); // fields the user typed in or changed since they were drawn
const fieldKey = (n) => n.getAttribute('data-focus-key') || n.id || n.getAttribute('name') || null;
/** Remember every field in root the user types in or changes (call once for the app's root). */
export function trackEdits(root) {
  const mark = (e) => {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) edited.add(t);
  };
  root.addEventListener('input', mark, true);
  root.addEventListener('change', mark, true);
}
/** What the user typed into root's fields that have a stable key: [{key, value, checked, type}]. */
export function captureTyped(root) {
  return Array.from(root.querySelectorAll('input,select,textarea'))
    .filter((n) => edited.has(n) && fieldKey(n))
    .map((n) => ({ key: fieldKey(n), value: n.value, checked: n.checked, type: n.type }));
}
/**
 * After a redraw: put back what was typed in fields that are still there and now show something else (an open form
 * that was not saved yet), firing the field's own event so the screen takes it in. Fields already saved show the
 * same value and are left alone.
 */
export function restoreTyped(root, typed) {
  if (!typed || !typed.length) return;
  const byKey = new Map();
  root.querySelectorAll('input,select,textarea').forEach((n) => {
    const k = fieldKey(n);
    if (k && !byKey.has(k)) byKey.set(k, n);
  });
  typed.forEach((t) => {
    const n = byKey.get(t.key);
    if (!n || n.disabled) return;
    const box = t.type === 'checkbox' || t.type === 'radio';
    if (box ? n.checked === t.checked : n.value === t.value) return;
    if (box) n.checked = t.checked;
    else n.value = t.value;
    edited.add(n);
    try {
      n.dispatchEvent(new Event(box || n.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    } catch (e) {
      /* the value is back on screen either way */
    }
  });
}
/** Run redraw() (which rebuilds root's contents) and keep keyboard focus where it was. */
export function keepFocus(root, redraw) {
  const saved = captureFocus(root);
  redraw();
  restoreFocus(root, saved);
}

/* ---------- toast ---------- */
/** Show a toast (with an Undo button when undo is given). Returns {close}: dismiss it early (e.g. its Undo went stale). */
export function toast(message, { undo, ms } = {}) {
  const host = document.getElementById('toast');
  if (!host) return { close() {} };
  const t = el('div', { class: 'toast' }, el('span', null, message));
  let timer;
  const duration = ms || (undo ? 8000 : 3500);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    t.remove();
  };
  // Stay open while the pointer is over it or something inside has keyboard focus; the clock restarts when both are gone.
  let over = false,
    focused = false;
  const restart = () => {
    clearTimeout(timer);
    if (!over && !focused) timer = setTimeout(close, duration);
  };
  t.addEventListener('pointerenter', () => {
    over = true;
    restart();
  });
  t.addEventListener('pointerleave', () => {
    over = false;
    restart();
  });
  t.addEventListener('mouseenter', () => {
    over = true;
    restart();
  });
  t.addEventListener('mouseleave', () => {
    over = false;
    restart();
  });
  t.addEventListener('focusin', () => {
    focused = true;
    restart();
  });
  t.addEventListener('focusout', () => {
    focused = false;
    restart();
  });
  document.addEventListener('keydown', onKey);
  if (undo) {
    t.append(
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            close();
            undo();
            // The Undo button just left the page, which would drop keyboard focus to the top. Park it on the panel heading, as a delete does.
            const ae = document.activeElement,
              root = document.getElementById('app');
            if (root && (!ae || ae === document.body)) {
              const h = root.querySelector('h1,h2') || root;
              if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
              try {
                h.focus({ preventScroll: true });
              } catch (e) {
                /* ignore */
              }
            }
          },
        },
        'Undo',
      ),
    );
  }
  host.append(t);
  restart();
  return { close };
}

/* ---------- two-tap buttons ---------- */
/** First tap arms (label changes, data-armed), second within ms confirms. Never uses confirm(). */
export function arm(btn, { label, armedLabel, onConfirm, ms = 4000, before }) {
  let timer = null;
  const text = (v) => (typeof v === 'function' ? v() : v); // a function: the label follows a rename
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    btn.removeAttribute('data-armed');
    btn.textContent = text(label);
  };
  btn.textContent = text(label);
  btn.addEventListener('click', () => {
    if (!timer && before && before() === false) return; // refused up front: no confirm step
    if (timer) {
      reset();
      onConfirm();
      return;
    }
    btn.setAttribute('data-armed', 'true');
    btn.textContent = text(armedLabel);
    timer = setTimeout(reset, ms);
  });
  btn.addEventListener('blur', () => {
    if (timer) reset();
  });
  return btn;
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

/* ---------- app bus (set by app.js) ---------- */
/** startSetup: open Setup (the guided flow when not set up) with focus on its first field. */
export const bus = { go: () => {}, rerender: () => {}, stateReplaced: () => {}, startSetup: () => {} };

/**
 * Shown on Tonight, Pay periods and Budget until TipNet is set up (see isSetUp in storage.js): no estimate, no entry form.
 * example: when given, a small "See an example first" link that calls it.
 */
export function setupFirstCard({ title = 'Finish setup first', text, example } = {}) {
  const go = el('button', { type: 'button', class: 'btn', id: 'setup-now' }, 'Set up now');
  go.addEventListener('click', () => bus.startSetup());
  const ex = example
    ? el('button', { type: 'button', class: 'btn-link', id: 'see-example' }, 'See an example first')
    : null;
  if (ex) ex.addEventListener('click', example);
  return el(
    'section',
    { class: 'card stack', 'aria-labelledby': 'setup-first-heading' },
    el('h2', { id: 'setup-first-heading', tabindex: '-1' }, title),
    el(
      'p',
      { class: 'note' },
      text ||
        'TipNet needs one recent paystub before it can estimate your real take-home. It takes about 3 minutes.',
    ),
    el('div', { class: 'cluster' }, go),
    ex ? el('div', null, ex) : null,
  );
}

/* ---------- restaurant switcher ---------- */
/**
 * One button per restaurant (shown only when there is more than one), the picked one filled. A radio group: Tab reaches
 * the picked button, the arrow keys (and Home/End) pick the next one right away. onPick(id) does the switching.
 * Each button keeps a stable data-focus-key ('<key>-<restaurant id>') so focus survives the redraw that follows.
 */
export function workplaceSwitcher(
  S,
  current,
  onPick,
  { key = 'wp', label = 'Establishment', all = null } = {},
) {
  const ws = (S && S.workplaces) || [];
  if (ws.length < 2) return null;
  // all: a label for an extra first choice that stands for every restaurant (id 'all'), e.g. the Pay periods filter.
  const list = (all ? [{ id: 'all', name: all }] : []).concat(ws);
  const group = el('div', { class: 'wp-switch', role: 'radiogroup', 'aria-label': label });
  const buttons = list.map((w) => {
    const on = w.id === current;
    const b = el(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(on),
        tabindex: on ? '0' : '-1',
        title: w.name,
        'data-focus-key': key + '-' + w.id,
        'data-workplace': w.id,
      },
      w.name,
    );
    b.addEventListener('click', () => {
      if (w.id !== current) onPick(w.id);
    });
    return b;
  });
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const n = buttons.length;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + n - 1) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j === null) return;
    e.preventDefault();
    buttons[j].focus(); // focus moves first, so the redraw keeps it on the newly picked restaurant
    if (list[j].id !== current) onPick(list[j].id);
  });
  if (!buttons.some((b) => b.tabIndex === 0)) buttons[0].tabIndex = 0;
  group.append(...buttons);
  return group;
}

/* ---------- saving ---------- */
let persistAsked = false;
/**
 * Debounced save of the cached state. Asks the browser to keep our data on the first save.
 * Resolves true once the change is really written, false if saving failed (see the banner in app.js).
 */
export function save() {
  const done = scheduleSave();
  if (!persistAsked) {
    persistAsked = true;
    requestPersist();
  }
  return done;
}

/* ---------- explanations (Setup > Explanations: Show / Hide) ---------- */
/**
 * Marks a how-it-works paragraph as an explanation. Returns the node to put in its place: a wrapper holding the
 * paragraph (data-explain) and a small "ⓘ" button. While explanations are shown the button is not displayed and the wrapper
 * does not exist as a box (display: contents), so nothing moves; css/components.css hides the paragraph when
 * <html data-explanations="hide">. The button opens that one paragraph until the screen is redrawn or it is tapped again.
 * Never use it for an error, a warning, a note that asks for action, a money label or value, or a live result.
 */
export function explain(node, about) {
  node.setAttribute('data-explain', '');
  if (!node.id) node.id = uid('explain');
  const btn = el(
    'button',
    {
      type: 'button',
      class: 'explain-btn',
      'aria-label': about ? 'Show explanation: ' + about : 'Show explanation', // about: the field it explains
      'aria-expanded': 'false',
      'aria-controls': node.id, // the paragraph it opens
    },
    'ⓘ',
  );
  const host = el('div', { class: 'explain-host' }, btn, node);
  btn.addEventListener('click', () => {
    const open = !host.hasAttribute('data-open');
    if (open) host.setAttribute('data-open', '');
    else host.removeAttribute('data-open');
    btn.setAttribute('aria-expanded', String(open));
  });
  return host;
}
/** Sets <html data-explanations="hide"> from settings.explanations ('hide'; anything else shows). */
export function applyExplanations(value) {
  const root = document.documentElement;
  if (value === 'hide') root.setAttribute('data-explanations', 'hide');
  else root.removeAttribute('data-explanations');
}
/** Nights saved (real ones) before Tonight offers to hide the explanations. */
export const NIGHTS_FOR_EXPLAIN_PROMPT = 10;
/** Pure. True with 10+ real nights saved and no answer yet (the Hide / Not now card on Tonight). */
export function explainPromptDue(S) {
  if (!S || S.nightsExample || !S.settings || !Array.isArray(S.nights)) return false;
  if (S.settings.explainPromptSeen === true || S.settings.explanations === 'hide') return false;
  return S.nights.length >= NIGHTS_FOR_EXPLAIN_PROMPT;
}
/** The one-time card on Tonight, or null. Either answer is kept so it never comes back. */
export function explainPromptCard() {
  const S = getState();
  if (!explainPromptDue(S)) return null;
  const answer = (hide) => {
    const st = getState().settings;
    st.explainPromptSeen = true;
    if (hide) st.explanations = 'hide';
    applyExplanations(st.explanations);
    save();
    bus.rerender();
  };
  const hideBtn = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'explain-prompt-hide' },
    'Hide explanations',
  );
  hideBtn.addEventListener('click', () => answer(true));
  const later = el('button', { type: 'button', class: 'btn-link', id: 'explain-prompt-later' }, 'Not now');
  later.addEventListener('click', () => answer(false));
  return el(
    'div',
    { class: 'banner', id: 'explain-prompt', role: 'region', 'aria-label': 'Explanations' },
    el(
      'p',
      null,
      'Getting the hang of it? Hide the explanations to keep screens short. You can turn them back on in Setup.',
    ),
    el('div', { class: 'cluster' }, hideBtn, later),
  );
}

/* ---------- theme ---------- */
export function applyTheme(theme) {
  const root = document.documentElement;
  try {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
      localStorage.setItem('tipnet-theme', theme);
    } else {
      root.removeAttribute('data-theme');
      localStorage.removeItem('tipnet-theme');
    }
  } catch (e) {
    /* storage blocked: theme still applies for this visit */
  }
}

/* ---------- install prompt (captured by app.js) ---------- */
export const install = { deferred: null, listeners: new Set() };
export function setInstallPrompt(e) {
  install.deferred = e;
  install.listeners.forEach((f) => f());
}

/** Set to open the restore-a-backup box on the Setup screen (read and cleared there). */
export const restoreRequest = { open: false };

/* ---------- example banner (shown on Tonight, Pay periods, Setup) ---------- */
/** The example nights were on screen this session ("Example nights cleared." is only said to someone who saw them). */
export const exampleShown = { seen: false };
export function exampleBanner({ restore = true } = {}) {
  const S = getState();
  if (!S.profileExample && !S.nightsExample) return null;
  if (!S.profileExample) exampleShown.seen = true; // "The nights listed are examples": they are on screen
  const text = S.profileExample
    ? 'You are looking at example numbers. Open Setup and enter your own paystub to get your real take-home.'
    : 'The nights listed are examples. Clear them before you start logging.';
  return el(
    'div',
    { class: 'banner' },
    el('p', null, text),
    S.profileExample && restore
      ? el(
          'button',
          {
            type: 'button',
            class: 'btn-link',
            onclick: () => {
              restoreRequest.open = true;
              bus.go('setup');
              bus.rerender();
            },
          },
          'Moving from another phone? Restore a backup code',
        )
      : null,
    S.nightsExample
      ? el(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary btn-small',
            onclick: () => {
              S.nights = [];
              S.workplaces[0].calib = []; // example mode is only ever about the first restaurant
              S.nightsExample = false;
              save();
              bus.rerender();
              toast('Example nights cleared.');
            },
          },
          'Clear example nights',
        )
      : null,
  );
}
