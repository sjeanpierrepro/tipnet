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

  // Leave this empty. It is only used if browsers ever stop allowing direct calls to
  // Lemon Squeezy; see proxy/lemonsqueezy-worker.js and DECISIONS.md.
  proxyUrl: '',
};
