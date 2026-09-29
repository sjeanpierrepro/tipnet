// TipNet billing settings. This is the ONLY file the owner edits to turn payments on.
// Full click-by-click steps are in PAYMENTS.md at the top of the project.
//
// While `provider` is null, the budgeting add-on stays locked and the app never
// contacts any payment service. The free app is never affected either way.

export const BILLING = {
  // STEP 3 (last step): change null to 'lemonsqueezy' (keep the quote marks) once the
  // two checkout links below are filled in.
  provider: null,

  // What the app shows customers. Change only if you change the price in Lemon Squeezy too.
  prices: { monthly: '$1.99', yearly: '$20' },

  // STEP 1: paste each variant's checkout link between the quote marks.
  // In Lemon Squeezy: Store > Products > TipNet Budget > the variant > Share > copy the link.
  // It looks like https://your-store.lemonsqueezy.com/buy/xxxxxxxx-xxxx-xxxx
  checkout: {
    monthly: '',
    yearly: '',
  },

  // STEP 2 (optional but recommended): only accept license keys from YOUR product.
  // In Lemon Squeezy each product has a number id. Paste it in the brackets, for example [123456].
  // Leave the brackets empty [] to accept any key that Lemon Squeezy says is valid.
  productIds: [],

  // Leave this empty. It is only used if browsers ever stop allowing direct calls to
  // Lemon Squeezy; see proxy/lemonsqueezy-worker.js and DECISIONS.md.
  proxyUrl: '',
};
