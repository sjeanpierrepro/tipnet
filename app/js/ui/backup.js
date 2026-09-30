// Backup (copy / restore code, erase) and the "put TipNet on your home screen" section.
import { encodeBackup, decodeBackup, setState, erasedState, flush } from '../storage.js';
import { subscriptionLine } from './budget.js';
import { budgetVisible } from '../billing.js';
import { el, toast, arm, bus, getState, applyTheme, install } from './common.js';

export function renderInstall(host) {
  const native = el('button', { type: 'button', class: 'btn', hidden: true }, 'Install TipNet');
  native.addEventListener('click', async () => {
    const e = install.deferred;
    if (!e) return;
    install.deferred = null;
    sync();
    try {
      e.prompt();
      await e.userChoice;
    } catch (err) {
      /* ignore */
    }
  });
  const standalone = (() => {
    try {
      return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    } catch (e) {
      return false;
    }
  })();
  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const status = el('p', { class: 'hint', hidden: !standalone }, 'You are using TipNet as an installed app.');
  const row = (a, b) =>
    el(
      'div',
      { class: 'spread', style: 'align-items:flex-start' },
      el('strong', null, a),
      el('span', { style: 'text-align:right' }, b),
    );
  const sync = () => {
    native.hidden = !install.deferred || standalone;
  };
  if (install.last) install.listeners.delete(install.last);
  install.last = sync;
  install.listeners.add(sync);
  sync();
  host.append(
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Put TipNet on your home screen'),
      el('p', { class: 'note' }, 'TipNet runs in any browser. Add it once so it opens like an app.'),
      status,
      native,
      ios
        ? el(
            'p',
            { class: 'note' },
            'On iPhone and iPad: tap the Share button in Safari, then Add to Home Screen.',
          )
        : null,
      el(
        'div',
        { class: 'stack-sm' },
        row('iPhone', 'Safari → Share → Add to Home Screen'),
        row('Android', 'Chrome → menu → Add to Home screen'),
        row('Mac', 'Safari → File → Add to Dock'),
        row('Windows', 'Edge → menu → Apps → Install this site as an app'),
      ),
      el(
        'p',
        { class: 'note' },
        el('strong', null, 'Always open TipNet the same way. '),
        'Your phone can keep the home-screen version and the browser version as two separate copies with different nights saved. If you switch, move your data with a backup code below.',
      ),
    ),
  );
}

const deviceEntitlement = () => {
  const st = getState();
  return (st && st.settings && st.settings.entitlement) || null;
};

/**
 * Replace everything with a pasted backup code. Throws Error('bad-backup') for a bad code.
 * The license belongs to this device: whatever the code says, we keep this device's own (or none).
 * Also used by the error screen in app.js.
 */
export function restoreFromCode(code) {
  const next = decodeBackup(code);
  const ent = deviceEntitlement();
  delete next.settings.entitlement;
  if (ent) next.settings.entitlement = ent;
  setState(next);
  const s = getState();
  applyTheme(s.settings.theme);
  flush();
  return s.nights.length;
}

/** Erase all nights and settings. Erasing your data does not cancel or lose your subscription. */
export function eraseEverything() {
  const ent = deviceEntitlement();
  const fresh = erasedState();
  if (ent) fresh.settings.entitlement = ent;
  setState(fresh);
  applyTheme('auto');
  flush();
}

export function renderBackup(host, { restoreOnly = false } = {}) {
  const S = getState();
  const box = el('textarea', {
    id: 'bk-code',
    placeholder: 'Paste a backup code here, then tap Restore.',
    spellcheck: 'false',
    autocapitalize: 'off',
    rows: '4',
  });
  const msg = el('p', { class: 'note', 'aria-live': 'polite', hidden: true });
  const say = (t) => {
    msg.hidden = false;
    msg.textContent = t;
  };

  const copy = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Copy backup code');
  copy.addEventListener('click', async () => {
    const code = encodeBackup(getState());
    box.value = code;
    try {
      await navigator.clipboard.writeText(code);
      say('Backup code copied. Paste it somewhere safe, like a note to yourself.');
    } catch (e) {
      box.focus();
      box.select();
      say('The code is selected below. Copy it by hand and keep it somewhere safe.');
    }
  });

  const restore = el('button', { type: 'button', class: 'btn btn-secondary btn-small' });
  const doRestore = () => {
    try {
      const count = restoreFromCode(box.value);
      toast('Restored ' + count + ' night' + (count === 1 ? '' : 's') + '.');
      bus.stateReplaced(restoreOnly ? { to: 'tonight' } : undefined); // from the first-launch Setup: straight to Tonight
    } catch (e) {
      say('That code didn’t work. Copy the whole code and try again.');
    }
  };
  const hasReal = !S.nightsExample && S.nights.length > 0;
  if (hasReal)
    arm(restore, {
      label: 'Restore from code',
      armedLabel: 'Tap again to replace what is here',
      onConfirm: doRestore,
    });
  else {
    restore.textContent = 'Restore from code';
    restore.addEventListener('click', doRestore);
  }

  const erase = el('button', { type: 'button', class: 'btn btn-danger btn-small' });
  arm(erase, {
    label: 'Erase everything',
    armedLabel: 'Tap again to erase all nights and settings',
    onConfirm: () => {
      eraseEverything();
      toast('Erased. TipNet starts fresh: set it up with your paystub.');
      bus.stateReplaced();
    },
  });

  if (restoreOnly) {
    // guided setup: just the paste box and Restore, nothing to copy or erase yet
    host.append(
      el(
        'section',
        { class: 'card stack', id: 'restore-card' },
        el('h2', null, 'Restore a backup'),
        el(
          'p',
          { class: 'note' },
          'On your old phone, open TipNet, go to Setup, and tap Copy backup code. Paste that code here.',
        ),
        el('div', { class: 'field' }, el('label', { for: 'bk-code' }, 'Backup code'), box),
        el('div', { class: 'cluster' }, restore),
        msg,
      ),
    );
    return;
  }
  host.append(
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Backup'),
      el(
        'p',
        { class: 'note' },
        'Your nights live only in this browser. Copy a backup code now and then, and paste it here on a new phone to restore.',
      ),
      el('div', { class: 'cluster' }, copy, restore),
      el('div', { class: 'field' }, el('label', { for: 'bk-code' }, 'Backup code'), box),
      msg,
      budgetVisible(S.settings.entitlement) ? subscriptionLine() : null, // hidden while payments are off
      el('div', null, erase),
    ),
  );
}
