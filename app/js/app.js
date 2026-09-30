// TipNet boot: load data, render the current tab, wire tabs, service worker and install prompt.
import * as storage from './storage.js';
import {
  bus,
  clear,
  applyTheme,
  setInstallPrompt,
  el,
  arm,
  keepFocus,
  toast,
  restoreRequest,
} from './ui/common.js';
import { budgetVisible, reloadConfig } from './billing.js';
import { restoreFromCode, eraseEverything, backupReminder } from './ui/backup.js';
import * as tonight from './ui/tonight.js';
import * as periods from './ui/periods.js';
import * as setup from './ui/setup.js';
import * as budget from './ui/budget.js';

const SCREENS = { tonight, periods, budget, setup };
const TABS = ['tonight', 'periods', 'budget', 'setup'];
let current = 'tonight';

/** Budget stays out of sight while payments are off, unless this device already has it unlocked. */
const budgetShown = () => budgetVisible((storage.getState().settings || {}).entitlement);
const visibleTabs = () => TABS.filter((t) => t !== 'budget' || budgetShown());
function syncTabs() {
  const shown = budgetShown();
  const b = document.querySelector('#tabs [data-tab="budget"]');
  if (b) b.hidden = !shown;
  return shown;
}

/** Shown when a screen crashes. It does not depend on the failed screen, so Restore and Erase always work. */
function errorScreen(root) {
  const box = el('textarea', {
    id: 'err-code',
    rows: '4',
    spellcheck: 'false',
    autocapitalize: 'off',
    placeholder: 'Paste a backup code here, then tap Restore.',
  });
  const msg = el('p', { class: 'note', 'aria-live': 'polite', hidden: true });
  const afterFix = () => {
    try {
      bus.stateReplaced({ to: 'tonight' }); // a working app again: Tonight (or Setup, when what is left is not set up)
    } catch (e) {
      render();
    }
  };
  const restore = el('button', { type: 'button', class: 'btn btn-secondary' }, 'Restore from a backup code');
  restore.addEventListener('click', () => {
    try {
      const n = restoreFromCode(box.value);
      toast('Restored ' + n + ' night' + (n === 1 ? '' : 's') + '.');
      afterFix();
    } catch (e) {
      msg.hidden = false;
      msg.textContent = 'That code did not work. Copy the whole code and try again.';
    }
  });
  const erase = el('button', { type: 'button', class: 'btn btn-danger' });
  arm(erase, {
    label: 'Erase everything',
    armedLabel: 'Tap again to erase all nights and settings',
    onConfirm: () => {
      eraseEverything();
      toast('Erased. TipNet starts fresh.');
      afterFix();
    },
  });
  root.append(
    el(
      'section',
      { class: 'card stack' },
      el('h2', { tabindex: '-1' }, 'Something went wrong'),
      el(
        'p',
        { class: 'note' },
        'TipNet could not show this screen. That usually means some saved data is damaged. Nothing was sent anywhere. You can reload, try another tab, restore a backup code, or erase everything and start fresh.',
      ),
      el('div', { class: 'field' }, el('label', { for: 'err-code' }, 'Backup code'), box),
      msg,
      el('div', { class: 'cluster' }, restore, erase),
    ),
  );
}

function render() {
  storage.lockFinished(); // a pay period that ended while the app was open locks before anything is drawn from Setup
  const root = document.getElementById('app');
  const y = window.scrollY;
  if (syncTabs() === false && current === 'budget') {
    go('tonight');
    return;
  }
  root.setAttribute('aria-labelledby', 'tab-' + current);
  keepFocus(root, () => {
    clear(root);
    try {
      SCREENS[current].render(root);
      if (current === 'tonight' || current === 'setup') {
        const nudge = backupReminder(); // "Last backup: never. Save a backup file" once there are 5+ real nights
        if (nudge) root.prepend(nudge);
      }
    } catch (e) {
      console.error(e);
      clear(root);
      try {
        errorScreen(root);
      } catch (e2) {
        root.textContent = 'Something went wrong. Reload the page.';
      }
    }
  });
  window.scrollTo(0, y);
}

function go(tab, { focus = false } = {}) {
  if (!SCREENS[tab] || (tab === 'budget' && !budgetShown())) tab = 'tonight';
  if (tab !== current) {
    try {
      periods.reset();
      budget.reset();
    } catch (e) {
      /* reset only clears screen memory */
    }
  } // switching tabs closes any open night editor and accuracy message
  current = tab;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  const s = storage.getState();
  if (s.settings.lastTab !== tab) {
    s.settings.lastTab = tab;
    storage.scheduleSave();
  }
  render();
  if (!focus) window.scrollTo(0, 0);
}

function wireTabs() {
  const nav = document.getElementById('tabs');
  nav.setAttribute('role', 'tablist');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  nav.addEventListener('keydown', (e) => {
    // arrow keys move between tabs
    const T = visibleTabs();
    const i = Math.max(0, T.indexOf(current));
    let n = null;
    if (e.key === 'ArrowRight') n = T[(i + 1) % T.length];
    else if (e.key === 'ArrowLeft') n = T[(i + T.length - 1) % T.length];
    else if (e.key === 'Home') n = T[0];
    else if (e.key === 'End') n = T[T.length - 1];
    if (n) {
      e.preventDefault();
      go(n, { focus: true });
    }
  });
}

/* ---------- service worker + update bar (never auto-reloads) ---------- */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const bar = document.getElementById('update-bar');
  const btn = document.getElementById('update-refresh');
  let waiting = null,
    reloading = false;
  const offer = (w) => {
    waiting = w;
    if (bar) bar.hidden = false;
  };
  if (btn) {
    btn.addEventListener('click', async () => {
      await storage.flush(); // never lose an entry to the reload
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
      else location.reload();
    });
  }
  // billing-config.js changed on the server (the worker answered from its cache and then found a newer copy): re-read it
  // so switching payments on shows up without waiting for the next open.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'BILLING_CONFIG_CHANGED')
      reloadConfig().then((ok) => {
        if (ok) render();
      });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return; // first install also fires this; only reload after the user asked
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
    })
    .catch(() => {
      /* offline support is a bonus; the app still works */
    });
}

async function boot() {
  const state = await storage.load();
  applyTheme(state.settings.theme);
  bus.go = go;
  bus.rerender = render;
  // After Erase everything / Restore. Not set up (erased, or a code with nothing in it): back to Setup, as on a first
  // launch. to: where a working state lands (a restore from the first-launch Setup goes to Tonight).
  bus.stateReplaced = ({ to } = {}) => {
    [periods.reset, budget.reset, tonight.resetDraft, setup.reset].forEach((f) => {
      try {
        f();
      } catch (e) {
        /* screen memory only */
      }
    });
    if (!storage.isSetUp(storage.getState())) go('setup');
    else if (to) go(to);
    else render();
  };
  bus.startSetup = () => {
    restoreRequest.open = false;
    go('setup');
    const first = document.querySelector('#app input, #app select, #app textarea');
    if (first) first.focus();
  };
  wireTabs();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setInstallPrompt(e);
  });
  window.addEventListener('appinstalled', () => setInstallPrompt(null));
  // flush writes the quick localStorage copy first (synchronously), then IndexedDB, so a closing page keeps its entry.
  window.addEventListener('pagehide', () => storage.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') storage.flush();
    else if (storage.lockFinished()) render(); // back after a period boundary: lock it, then redraw
  });
  // Another copy of TipNet (a second tab, or the installed app and a browser tab) saved: show its data here too.
  // Changes made here that were not saved yet are merged in, not lost.
  storage.setExternalHandler(({ conflict }) => {
    applyTheme(storage.getState().settings.theme);
    render();
    if (conflict) toast('TipNet was updated in another window. Showing the latest.');
  });
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === 'tipnet.v2') storage.syncFromStorage();
  });
  // A failed save (storage full or blocked) says so; the data stays in memory while TipNet is open.
  const saveError = document.getElementById('save-error');
  storage.setSaveHandler((ok) => {
    if (saveError) saveError.hidden = ok;
  });
  const retry = document.getElementById('save-retry');
  if (retry) retry.addEventListener('click', () => storage.flush());
  // Capture phase runs before the screens' own handlers, so a Setup edit made after midnight cannot reach a finished period first.
  ['input', 'change', 'click'].forEach((t) =>
    document.addEventListener(
      t,
      () => {
        storage.lockFinished();
      },
      true,
    ),
  );
  budget.bootBilling(); // may add the localhost dev unlock, so it runs before the first render decides whether Budget shows
  // Not set up yet (first launch, or erased): open Setup, whatever tab was last. Everyone else returns to their last tab.
  if (!storage.isSetUp(state)) go('setup');
  else go(TABS.includes(state.settings.lastTab) ? state.settings.lastTab : 'tonight');
  setupServiceWorker();
}

boot();
