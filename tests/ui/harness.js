// DOM test harness: a fresh happy-dom window per boot(), loaded with app/index.html's body, then app/js/app.js.
// The app's modules are shared (Node caches them), so boot() first resets every piece of module-level state
// (storage cache, screen drafts, billing config, install prompt) and the window/document/localStorage globals are replaced.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Window } from 'happy-dom';
import * as storage from '../../app/js/storage.js';
import { seedState } from '../../app/js/storage.js';
import * as common from '../../app/js/ui/common.js';
import * as tonight from '../../app/js/ui/tonight.js';
import * as periods from '../../app/js/ui/periods.js';
import * as budget from '../../app/js/ui/budget.js';
import * as setup from '../../app/js/ui/setup.js';
import * as backup from '../../app/js/ui/backup.js';
import { BILLING } from '../../app/js/billing.js';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');
const indexHtml = readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const bodyHtml = indexHtml
  .replace(/^[\s\S]*<body[^>]*>/i, '')
  .replace(/<\/body>[\s\S]*$/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

// Timers must not keep the test process alive (toasts and two-tap buttons use 4-5 s timers).
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...a) => {
  const t = realSetTimeout(...a);
  if (t && t.unref) t.unref();
  return t;
};

// The clock: every boot() pins the time of day (default 14:00 local, on today's date) so no UI test depends on the real
// time of day (before 6 a.m. the Late-nights rule dates a night to yesterday). The clock keeps ticking from there.
// A test that cares passes boot({ time: '01:30' }). Fake dates from tools/fake-today.mjs are respected; a fake moment
// WITH a time (TIPNET_FAKE_TODAY=2026-10-05T01:30, the run-dates night runs) is the default time instead of 14:00, so
// every screen is also tested at night. A test that installs mock.timers must pass boot({ time: null }) (checked).
const BaseDate = globalThis.Date;
const fakeTime = /T(\d{2}:\d{2})$/.exec(process.env.TIPNET_FAKE_TODAY || '');
export const DEFAULT_TIME = fakeTime ? fakeTime[1] : '14:00';
let pinned = null; // the Date class the last pin installed
function pinTime(time) {
  if (pinned && globalThis.Date !== pinned)
    throw new Error(
      'The clock was replaced (mock.timers?) while the harness pins the time of day: pass boot({ time: null }) ' +
        'so the mocked clock is used, not silently overridden.',
    );
  const [h, m] = time.split(':').map(Number);
  const n = new BaseDate();
  const offset = new BaseDate(n.getFullYear(), n.getMonth(), n.getDate(), h, m, 0).getTime() - n.getTime();
  pinned = globalThis.Date = class PinnedDate extends BaseDate {
    constructor(...args) {
      if (args.length === 0) super(BaseDate.now() + offset);
      else super(...args);
    }
    static now() {
      return BaseDate.now() + offset;
    }
  };
}
pinTime(DEFAULT_TIME);

const setGlobal = (k, v) =>
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
const tick = () => new Promise((r) => setImmediate(r));
let bootN = 0;

/**
 * boot({url, seed, payments}) -> the page.
 *   url:      page address (hostname and ?unlock=dev matter). Default http://localhost/
 *   seed:     a state object written to localStorage (tipnet.v2) before the app starts. Default: first run.
 *   time:     the local time of day the clock shows at boot ('HH:MM', default DEFAULT_TIME), on today's date; null: no
 *             pin (required with mock.timers).
 *   payments: true switches payments on in memory (BILLING.provider) before the app starts.
 */
export async function boot({
  url = 'http://localhost/',
  seed = null,
  payments = false,
  time = DEFAULT_TIME,
} = {}) {
  if (time) pinTime(time);
  const win = new Window({
    url,
    width: 390,
    height: 800,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  const doc = win.document;
  doc.body.innerHTML = bodyHtml;
  [
    'window',
    'document',
    'localStorage',
    'location',
    'navigator',
    'history',
    'Event',
    'KeyboardEvent',
    'HTMLElement',
    'Node',
  ].forEach((k) => setGlobal(k, k === 'window' ? win : win[k]));
  setGlobal('matchMedia', (q) => win.matchMedia(q));
  if (seed) win.localStorage.setItem('tipnet.v2', JSON.stringify(seed));

  // reset module-level state left by an earlier window
  storage._resetCache();
  tonight.resetDraft();
  periods.reset();
  budget.reset();
  setup.reset();
  backup.iosNote.shown = false;
  common.install.deferred = null;
  common.install.listeners.clear();
  common.install.last = null;
  common.exampleShown.seen = false;
  BILLING.provider = payments ? 'lemonsqueezy' : null;
  BILLING.checkout.monthly = '';
  BILLING.checkout.yearly = '';

  await import(pathToFileURL(path.join(APP_DIR, 'js/app.js')).href + '?w=' + ++bootN);
  const app = doc.getElementById('app');
  for (let i = 0; i < 200 && !app.firstChild; i++) await tick();
  await tick();
  return makePage(win, doc, app);
}

function makePage(win, doc, app) {
  const page = {
    win,
    doc,
    app,
    $: (sel, root = doc) => root.querySelector(sel),
    $$: (sel, root = doc) => Array.from(root.querySelectorAll(sel)),
    text: (root = app) => root.textContent.replace(/\s+/g, ' ').trim(),
    /** First element matching sel whose text contains `text`. */
    byText(sel, text, root = doc) {
      return Array.from(root.querySelectorAll(sel)).find((n) => n.textContent.includes(text)) || null;
    },
    must(node, what) {
      if (!node) throw new Error('not found: ' + what);
      return node;
    },
    button(text, root = doc) {
      return page.must(page.byText('button', text, root), 'button "' + text + '"');
    },
    /** Click a button by its exact aria-label (or visible text when it has none). */
    byLabel(label) {
      return page.must(
        page.$$('button,a').find((n) => (n.getAttribute('aria-label') || n.textContent.trim()) === label),
        'control "' + label + '"',
      );
    },
    click(node) {
      node.click();
    },
    type(input, value) {
      input.value = value;
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
    },
    change(input) {
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
    },
    /** Press a key. happy-dom has no implicit form submission, so Enter in a text field clicks the form's submit button (as browsers do) unless the page handled the key. */
    key(node, k) {
      const ev = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      node.dispatchEvent(ev);
      if (k === 'Enter' && !ev.defaultPrevented && node.tagName === 'INPUT' && node.form) {
        const submitter = node.form.querySelector('button[type=submit],input[type=submit]');
        if (submitter && !submitter.disabled) submitter.click();
      }
    },
    tab(name) {
      page.click(page.must(doc.querySelector('#tabs [data-tab="' + name + '"]'), 'tab ' + name));
    },
    /**
     * Full Setup page: go to Setup and open a restaurant's row (by name; default the first) so its cards are editable.
     * Edits there are a draft until page.saveSetup().
     */
    openSetup(name) {
      const sel = doc.querySelector('#tabs [aria-selected="true"]');
      if (!sel || sel.dataset.tab !== 'setup') page.tab('setup');
      const rows = page.$$('button.fold-head[id^="wp-row-"]');
      const row = page.must(
        name ? rows.find((b) => b.querySelector('.fold-title').textContent === name) : rows[0],
        'restaurant row ' + (name || '(first)'),
      );
      if (row.getAttribute('aria-expanded') !== 'true') page.click(row);
      return page.$('#' + row.id);
    },
    /** Save the open restaurant on the full Setup page (throws, with the reasons, if Save is disabled). */
    async saveSetup() {
      const b = page.must(page.$('#draft-save'), 'Save button');
      if (b.disabled) throw new Error('Save is disabled: ' + page.text(page.$('#draft-reasons')));
      page.click(b);
      await page.settle();
    },
    tabHidden(name) {
      return doc.querySelector('#tabs [data-tab="' + name + '"]').hidden;
    },
    settle: async () => {
      for (let i = 0; i < 5; i++) await tick();
    },
    state: () => storage.getState(),
    async close() {
      try {
        await win.happyDOM.close();
      } catch (e) {
        /* ignore */
      }
    },
  };
  return page;
}

/** Hide expected console.error noise (the app logs render errors on purpose) while fn runs. */
export async function quiet(fn) {
  const was = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = was;
  }
}

/** A hand-written backup code (base64 of JSON), like someone could paste from a note. */
export const toCode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

/**
 * A real (non-example) state to seed: the example profile numbers, no nights. mutate(state) may change it.
 * Like a state saved before entry modes existed, it has no entryMode, so it loads as an existing user's ('total').
 * Set S.workplaces[0].profile.entryMode = 'tips' in mutate for a tips-only user.
 */
export function realState(mutate) {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [];
  delete S.workplaces[0].profile.entryMode;
  if (mutate) mutate(S);
  return S;
}
