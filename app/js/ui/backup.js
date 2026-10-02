// Backup (copy / restore code, save / restore file, erase), the "Last backup" reminder, and the "put TipNet on your
// home screen" section.
import {
  encodeBackup,
  decodeBackup,
  decodeBackupFile,
  backupFileText,
  setState,
  erasedState,
  flush,
  isSetUp,
} from '../storage.js';
import { todayISO } from '../math.js';
import { el, toast, arm, bus, getState, applyTheme, install, save, fmtShort } from './common.js';

const DAY = 24 * 3600 * 1000;
/** The iPhone "Safari may clear data" note shows once: it stays for the rest of the visit it first appeared in. */
export const iosNote = { shown: false };

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
  // Safari on iPhone/iPad (not the Home Screen app): navigator.standalone is false there, undefined in other browsers.
  const S = getState();
  let evictNote = null;
  if (ios && navigator.standalone === false && !standalone && (iosNote.shown || !S.settings.iosNoteSeen)) {
    iosNote.shown = true;
    if (!S.settings.iosNoteSeen) {
      S.settings.iosNoteSeen = true;
      save();
    }
    evictNote = el(
      'p',
      { class: 'note', id: 'ios-evict-note' },
      'On iPhone, Safari may clear a website’s data if you don’t open it for about a week. Add TipNet to your Home Screen and keep a backup.',
    );
  }
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
      evictNote,
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
 * Is there anything here a restore would throw away? A finished restaurant setup, real nights, or budget items.
 * Then Restore takes two taps.
 */
export function worthKeeping(S) {
  if (!S) return false;
  if (isSetUp(S)) return true;
  if (!S.nightsExample && Array.isArray(S.nights) && S.nights.length > 0) return true;
  const b = S.budget || {};
  if (['bills', 'categories', 'goals', 'spends', 'income'].some((k) => Array.isArray(b[k]) && b[k].length))
    return true;
  return !!(b.balance && !b.balance.example);
}

/** What was here before the last restore, while its Undo is offered (memory only, never saved). */
let beforeRestore = null;
/** Put back what was here before the last restore. Returns false when there is nothing to put back. */
export function undoRestore() {
  if (!beforeRestore) return false;
  const prev = beforeRestore;
  beforeRestore = null;
  const ent = deviceEntitlement(); // the license stays as it is now on this device
  delete prev.settings.entitlement;
  if (ent) prev.settings.entitlement = ent;
  setState(prev);
  applyTheme(getState().settings.theme);
  flush();
  return true;
}

/** Replace everything with a decoded backup. The license belongs to this device: keep its own (or none). */
function restoreState(next) {
  try {
    beforeRestore = JSON.parse(JSON.stringify(getState()));
  } catch (e) {
    beforeRestore = null;
  }
  const ent = deviceEntitlement();
  delete next.settings.entitlement;
  if (ent) next.settings.entitlement = ent;
  setState(next);
  const s = getState();
  applyTheme(s.settings.theme);
  flush();
  return s.nights.length;
}
/**
 * Replace everything with a pasted backup code. Throws Error('bad-backup') for a bad code.
 * Also used by the error screen in app.js.
 */
export function restoreFromCode(code) {
  return restoreState(decodeBackup(code));
}
/** Replace everything with the text of a backup file. Throws Error('bad-backup') if it is not a TipNet backup. */
export function restoreFromFileText(text) {
  return restoreState(decodeBackupFile(text));
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

/* ---------- backup files ---------- */
/** Hands a file to the browser as a download (a Blob and a link with download=). Tests replace save. */
export const fileSaver = {
  save(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};
export const backupFileName = (today = todayISO()) => 'tipnet-backup-' + today + '.json';
const markBackedUp = () => {
  getState().settings.lastBackupAt = Date.now();
  save();
};
/** Download tipnet-backup-YYYY-MM-DD.json: the same data as a backup code (no license key). */
export function saveBackupFile() {
  fileSaver.save(backupFileName(), backupFileText(getState()));
  markBackedUp();
}
const FILE_SAVED = 'Backup file saved. Keep a copy somewhere safe, like your email or cloud storage.';

/* ---------- "Last backup" reminder (Tonight and Setup) ---------- */
/** Pure. Remind when there are 5+ real nights and no backup in 30 days (or ever), unless dismissed in the last 30 days. */
export function backupDue(S, now = Date.now()) {
  if (!S || S.nightsExample || !Array.isArray(S.nights) || S.nights.length < 5) return false;
  const st = S.settings || {};
  if (st.backupNudgeUntil && now < st.backupNudgeUntil) return false;
  return !st.lastBackupAt || now - st.lastBackupAt > 30 * DAY;
}
/** The reminder banner, or null when no backup is due. */
export function backupReminder() {
  const S = getState();
  if (!backupDue(S)) return null;
  const last = S.settings.lastBackupAt;
  const saveBtn = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'nudge-save' },
    'Save a backup file',
  );
  saveBtn.addEventListener('click', () => {
    saveBackupFile();
    toast(FILE_SAVED);
    bus.rerender();
  });
  const later = el('button', { type: 'button', class: 'btn-link', id: 'nudge-later' }, 'Remind me later');
  later.addEventListener('click', () => {
    getState().settings.backupNudgeUntil = Date.now() + 30 * DAY;
    save();
    bus.rerender();
  });
  return el(
    'div',
    { class: 'banner backup-nudge', id: 'backup-nudge' },
    el(
      'p',
      null,
      'Last backup: ' + (last ? fmtShort(todayISO(new Date(last))) : 'never') + '. ',
      'Your nights live only on this device.',
    ),
    el('div', { class: 'cluster' }, saveBtn, later),
  );
}

/** The restore toast's Undo: back to what was here, and show it. */
export function undoRestoreAndShow() {
  if (!undoRestore()) return;
  toast('Restore undone. Your earlier data is back.');
  bus.stateReplaced();
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
  const lastText = () => {
    const at = getState().settings.lastBackupAt;
    return 'Last backup: ' + (at ? fmtShort(todayISO(new Date(at))) : 'never') + '.';
  };
  const lastLine = el('p', { class: 'hint', id: 'bk-last' }, lastText());
  const backedUp = () => {
    markBackedUp();
    lastLine.textContent = lastText();
  };

  const copy = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Copy backup code');
  copy.addEventListener('click', async () => {
    const code = encodeBackup(getState());
    box.value = code;
    backedUp();
    try {
      await navigator.clipboard.writeText(code);
      say('Backup code copied. Paste it somewhere safe, like a note to yourself.');
    } catch (e) {
      box.focus();
      box.select();
      say('The code is selected below. Copy it by hand and keep it somewhere safe.');
    }
  });

  const hasReal = worthKeeping(S); // anything to lose: Restore asks twice
  const restored = (count) => {
    toast('Restored ' + count + ' night' + (count === 1 ? '' : 's') + '.', { undo: undoRestoreAndShow });
    bus.stateReplaced(restoreOnly ? { to: 'tonight' } : undefined); // from the first-launch Setup: straight to Tonight
  };
  const restore = el('button', { type: 'button', class: 'btn btn-secondary btn-small' });
  const doRestore = () => {
    try {
      restored(restoreFromCode(box.value));
    } catch (e) {
      say('That code didn’t work. Copy the whole code and try again.');
    }
  };
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

  // Backup file: saved with a download; restored from a file picked on this device (read here, never uploaded).
  const saveFile = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'bk-save-file' },
    'Save a backup file',
  );
  saveFile.addEventListener('click', () => {
    fileSaver.save(backupFileName(), backupFileText(getState()));
    backedUp();
    say(FILE_SAVED);
  });
  const fileIn = el('input', {
    type: 'file',
    id: 'bk-file',
    accept: '.json,application/json,text/plain',
    hidden: true,
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    let text;
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('too big');
      text = await f.text();
    } catch (e) {
      say('That file could not be read. Pick the tipnet-backup file you saved.');
      return;
    }
    try {
      fileIn.value = '';
    } catch (e) {
      /* some browsers do not allow resetting it */
    }
    try {
      restored(restoreFromFileText(text));
    } catch (e) {
      say('That file is not a TipNet backup. Pick the tipnet-backup file you saved.');
    }
  });
  const openFile = el('button', {
    type: 'button',
    class: 'btn btn-secondary btn-small',
    id: 'bk-restore-file',
  });
  if (hasReal)
    arm(openFile, {
      label: 'Restore from a file',
      armedLabel: 'Tap again to pick a file and replace what is here',
      onConfirm: () => fileIn.click(),
    });
  else {
    openFile.textContent = 'Restore from a file';
    openFile.addEventListener('click', () => fileIn.click());
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
    // guided setup: just the paste box, Restore and a backup file, nothing to copy or erase yet
    host.append(
      el(
        'section',
        { class: 'card stack', id: 'restore-card' },
        el('h2', null, 'Restore a backup'),
        el(
          'p',
          { class: 'note' },
          'On your old phone, open TipNet, go to Setup, and tap Copy backup code. Paste that code here. Or, if you saved a backup file, tap Restore from a file.',
        ),
        el('div', { class: 'field' }, el('label', { for: 'bk-code' }, 'Backup code'), box),
        el('div', { class: 'cluster' }, restore, openFile),
        fileIn,
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
        'Your nights live only in this browser. Now and then, save a backup file or copy a backup code, and use it here on a new phone to restore.',
      ),
      lastLine,
      el('div', { class: 'cluster' }, saveFile, openFile),
      fileIn,
      el('div', { class: 'cluster' }, copy, restore),
      el('div', { class: 'field' }, el('label', { for: 'bk-code' }, 'Backup code'), box),
      msg,
      el('div', null, erase),
    ),
  );
}
