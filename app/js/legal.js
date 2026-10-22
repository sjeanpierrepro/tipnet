// To change the contact email shown on the Privacy and Terms pages, edit the address below, then bump VERSION in app/sw.js and push.
import { providerInfo } from './billing.js';

export const CONTACT_EMAIL = 'hello@tipmynet.com';

/**
 * Fills the payment provider's name and privacy link from billing-config.js (through providerInfo). The pages ship with
 * Lemon Squeezy's wording, which is also what they say while payments are off.
 */
export function fillProvider(doc, info) {
  for (const el of doc.querySelectorAll('[data-provider-name]')) el.textContent = info.name;
  for (const el of doc.querySelectorAll('[data-provider-cancel]')) el.textContent = info.cancelWhere;
  for (const el of doc.querySelectorAll('a[data-provider-privacy]')) {
    el.textContent = info.privacyLabel;
    el.href = info.privacyUrl;
  }
}

for (const el of document.querySelectorAll('a[data-contact-email]')) {
  el.textContent = CONTACT_EMAIL;
  el.href = 'mailto:' + CONTACT_EMAIL;
}
fillProvider(document, providerInfo());
