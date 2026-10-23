// TipNet billing settings. The owner edits this file to turn payments on. Installed apps refresh this file in the
// background, so adding 1 to VERSION in app/sw.js is optional for this change, but recommended (it makes every installed
// copy offer "Refresh" right away). Full click-by-click steps are in PAYMENTS.md.
//
// While `provider` is null, the budgeting add-on stays locked and the app never contacts any payment service.
// The free app is never affected either way.
//
// Payments are ON through Polar (owner decision 2026-10-23: Polar approved the store; Lemon Squeezy had not answered).
// The ids and checkout links below are public, not secrets. Polar's key check is public too: no token, no server.

export const BILLING = {
  provider: 'polar',

  // What the app shows customers. Change only if you change the price in Polar too.
  prices: { monthly: '$1.99', yearly: '$20' },

  // Polar checkout links (Products > Checkout Links). Return URL on both: https://tipmynet.com/
  checkout: {
    monthly: 'https://buy.polar.sh/polar_cl_aJdygUsBhyW7sa8I25xOkPxhVGuZD1fBaIFeR2CF3Bv',
    yearly: 'https://buy.polar.sh/polar_cl_EDrUG3TiCtUWWfIiwPbPulFbwx3TPThNFH4de1TG1IF',
  },

  organizationId: '21069ded-8117-4125-a4da-1e9c11e82ea8', // required: Polar organization TipNet
  benefitId: 'b74169ed-9c5f-4dab-96c9-d1a9dbacd974', // required: the TIPNET license-key benefit (3 devices)
  portalUrl: 'https://polar.sh/tipnet/portal', // where "Manage subscription" opens

  // Leave this empty. Only if browsers ever block direct calls to Polar: set it to a proxy you run and add its
  // origin to connect-src.
  proxyUrl: '',
};

/*
 * LEMON SQUEEZY (not used: the store was never approved). To switch back, replace the BILLING block above with this one
 * and fill in its checkout links and product id. Steps: PAYMENTS.md. Switching locks the other provider's payers at
 * their next daily check, and the Privacy and Terms "Last updated" dates must be changed too.
 *
 * export const BILLING = {
 *   provider: 'lemonsqueezy',
 *   prices: { monthly: '$1.99', yearly: '$20' },
 *   checkout: { monthly: '', yearly: '' },
 *   productIds: [],
 *   allowTestMode: false,
 *   proxyUrl: '',
 * };
 */
