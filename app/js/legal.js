// To change the contact email shown on the Privacy and Terms pages, edit the address below, then bump VERSION in app/sw.js and push.
export const CONTACT_EMAIL = 'sjeanpierrepro@gmail.com';

for (const el of document.querySelectorAll('a[data-contact-email]')) {
  el.textContent = CONTACT_EMAIL;
  el.href = 'mailto:' + CONTACT_EMAIL;
}
