// TipNet boot: load data, render the current tab, wire tabs, service worker and install prompt.
import * as storage from './storage.js';
import { bus, clear, applyTheme, setInstallPrompt, save } from './ui/common.js';
import * as tonight from './ui/tonight.js';
import * as periods from './ui/periods.js';
import * as setup from './ui/setup.js';
import * as budget from './ui/budget.js';

const SCREENS = { tonight, periods, budget, setup };
const TABS = ['tonight', 'periods', 'budget', 'setup'];
let current = 'tonight';

function render() {
  const root = document.getElementById('app');
  const y = window.scrollY;
  clear(root);
  try {
    SCREENS[current].render(root);
  } catch (e) {
    console.error(e);
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Something went wrong showing this screen. Your saved nights are safe. Try another tab, or reload.';
    root.append(p);
  }
  window.scrollTo(0, y);
}

function go(tab, { focus = false } = {}) {
  if (!SCREENS[tab]) tab = 'tonight';
  if (tab !== current) { periods.reset(); budget.reset(); } // switching tabs closes any open night editor and accuracy message
  current = tab;
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  const s = storage.getState();
  if (s.settings.lastTab !== tab) { s.settings.lastTab = tab; storage.scheduleSave(); }
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
  nav.addEventListener('keydown', (e) => { // arrow keys move between tabs
    const i = TABS.indexOf(current);
    let n = null;
    if (e.key === 'ArrowRight') n = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') n = TABS[(i + TABS.length - 1) % TABS.length];
    else if (e.key === 'Home') n = TABS[0];
    else if (e.key === 'End') n = TABS[TABS.length - 1];
    if (n) { e.preventDefault(); go(n, { focus: true }); }
  });
  document.getElementById('app').setAttribute('role', 'tabpanel');
}

/* ---------- service worker + update bar (never auto-reloads) ---------- */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const bar = document.getElementById('update-bar');
  const btn = document.getElementById('update-refresh');
  let waiting = null, reloading = false;
  const offer = (w) => { waiting = w; if (bar) bar.hidden = false; };
  if (btn) {
    btn.addEventListener('click', async () => {
      await storage.flush(); // never lose an entry to the reload
      if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
      else location.reload();
    });
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return; // first install also fires this; only reload after the user asked
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => { /* offline support is a bonus; the app still works */ });
}

async function boot() {
  const state = await storage.load();
  applyTheme(state.settings.theme);
  bus.go = go;
  bus.rerender = render;
  bus.stateReplaced = () => { periods.reset(); budget.reset(); tonight.resetDraft(); setup.reset(); render(); }; // after Erase everything / Restore
  wireTabs();
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); setInstallPrompt(e); });
  window.addEventListener('appinstalled', () => setInstallPrompt(null));
  window.addEventListener('pagehide', () => storage.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') storage.flush(); });
  go(TABS.includes(state.settings.lastTab) ? state.settings.lastTab : 'tonight');
  budget.bootBilling();
  setupServiceWorker();
}

boot();
