// TipNet billing settings. The owner edits this file to turn payments on. Installed apps refresh this file in the
// background, so adding 1 to VERSION in app/sw.js is optional for this change, but recommended (it makes every installed
// copy offer "Refresh" right away). Full click-by-click steps are in PAYMENTS.md.
//
// While `provider` is null (or productIds is empty), the budgeting add-on stays locked and the app never
// contacts any payment service. The free app is never affected either way.

export const BILLING = {
  // STEP 3 (last step): change null to 'lemonsqueezy' (keep the quote marks) once the
  // two checkout links below are filled in.
  provider: null,

  // What the app shows customers. Change only if you change the price in Lemon Squeezy too.
  prices: { monthly: '$1.99', yearly: '$20' },

  // STEP 1: paste each variant's checkout link between the quote marks.
  // In Lemon Squeezy: Products > TipNet Budget > Share > pick the variant > copy the link.
  // It looks like https://your-store.lemonsqueezy.com/checkout/buy/xxxxxxxx-xxxx-xxxx
  // (never a link with "?cart=" in it: those are single-use).
  checkout: {
    monthly: '',
    yearly: '',
  },

  // STEP 2 (required): only accept license keys from YOUR product.
  // In Lemon Squeezy each product has a number id. Paste it in the brackets, for example [123456].
  // While the brackets are empty [], payments stay OFF: otherwise a key from any store would unlock Budget.
  productIds: [],

  // For your own testing only. Lemon Squeezy Test mode makes "test keys"; the app rejects them unless this is true.
  // Set it to true while you try a test purchase (see PAYMENTS.md), and set it back to false before going live.
  allowTestMode: false,

  // Leave this empty. Only if browsers ever block direct calls to Lemon Squeezy: set it to a proxy you run and add its
  // origin to connect-src. See DECISIONS.md (Payments) and git history for a proxy example.
  proxyUrl: '',
};

/*
 * SWITCH TO POLAR (only if Lemon Squeezy does not approve the store). This is the ONLY file to edit. Step by step: see
 * PAYMENTS.md, "Switch to Polar". Replace the BILLING block above with the one below (remove the // at the start of each
 * line). The ids and checkout links are public, not secrets. Polar's key check is public too: no token, no server.
 *
 * export const BILLING = {
 *   provider: 'polar',
 *   prices: { monthly: '$1.99', yearly: '$20' },
 *   checkout: {
 *     monthly: 'https://buy.polar.sh/polar_cl_aJdygUsBhyW7sa8I25xOkPxhVGuZD1fBaIFeR2CF3Bv',
 *     yearly: 'https://buy.polar.sh/polar_cl_EDrUG3TiCtUWWfIiwPbPulFbwx3TPThNFH4de1TG1IF',
 *   },
 *   organizationId: '21069ded-8117-4125-a4da-1e9c11e82ea8', // required: Polar organization TipNet
 *   benefitId: 'b74169ed-9c5f-4dab-96c9-d1a9dbacd974', // required: the TIPNET license-key benefit
 *   portalUrl: 'https://polar.sh/tipnet/portal', // where "Manage subscription" opens
 *   proxyUrl: '',
 * };
 */
