// "Put TipNet on your home screen": what this device can do, and the pieces the Setup step and Setup > Backup share.
import { el, install } from './common.js';

/** Running as the installed app (home-screen icon), not in a browser tab. */
export function isStandalone() {
  try {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  } catch (e) {
    return false;
  }
}
export function isIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
export const isAndroid = () => /android/i.test(navigator.userAgent || '');
/** Safari on iPhone/iPad, not the Home Screen app (navigator.standalone is false there, undefined in other browsers). */
export const isIosSafariTab = () => isIos() && navigator.standalone === false && !isStandalone();

/**
 * Which "home screen" step the first guided setup gets on this device:
 *  'ios'     iPhone/iPad Safari: FIRST, before step 1 (Safari and the home-screen app keep separate data), until chosen once
 *  'prompt'  the browser offered an install prompt (Android Chrome, desktop Chrome/Edge): LAST, after setup is saved
 *  'android' Android with no prompt: LAST, with the menu steps
 *  null      already installed, or no way to install from here (e.g. desktop Firefox)
 */
export function installStepKind(settings) {
  if (isStandalone()) return null;
  if (isIosSafariTab()) return settings && settings.installStepSeen ? null : 'ios';
  if (install.deferred) return 'prompt';
  if (isAndroid()) return 'android';
  return null;
}

/** Show the browser's install prompt. Returns 'accepted', 'dismissed', or null when there is no prompt to show. */
export async function promptInstall() {
  const e = install.deferred;
  if (!e) return null;
  install.deferred = null;
  install.listeners.forEach((f) => f());
  try {
    e.prompt();
    const c = await e.userChoice;
    return c && c.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (err) {
    return 'dismissed';
  }
}

/** The numbered how-to for the step; kind 'ios' or 'android'. */
export function installHowTo(kind) {
  return kind === 'ios'
    ? el(
        'ol',
        { class: 'stack-sm', id: 'install-howto' },
        el('li', null, 'Tap the Share button in Safari (the square with an arrow).'),
        el('li', null, 'Tap Add to Home Screen, then tap Add.'),
        el('li', null, 'Open TipNet from the new icon on your Home Screen and set up there.'),
      )
    : el(
        'ol',
        { class: 'stack-sm', id: 'install-howto' },
        el('li', null, 'Tap the Chrome menu (⋮) at the top right.'),
        el('li', null, 'Tap Install app, or Add to Home screen.'),
        el('li', null, 'Open TipNet from the new icon on your Home screen.'),
      );
}
