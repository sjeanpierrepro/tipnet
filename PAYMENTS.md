# Payments (TipNet Budget)

TipNet stays free. The budgeting add-on costs $1.99 a month or $20 a year. **Payments are ON through Polar** (polar.sh) since tipnet-v43 (October 23, 2026): customers pay on Polar's checkout page, Polar emails them a license key, they paste the key into TipNet and the add-on unlocks. You run no server.

## What Polar does for you
- It is the "merchant of record": it sells to your customers, collects and pays sales tax and VAT, and handles receipts and chargebacks. You do not register for sales tax.
- Fees: check Polar's pricing page (at setup it was about 4% + 40 cents per sale).
- Payouts go to the bank account connected through Stripe in the Polar dashboard (Finance > Payouts). Polar's account review is done.

## What is set up (Polar dashboard, organization "TipNet")
- License-key benefit "TipNet Budget license key": prefix TIPNET, never expires, **3 devices** ("Limit activations" = 3), customers can manage their devices in the portal. Polar revokes the key when a subscription ends or is refunded.
- Products: "TipNet Budget (monthly)" $1.99/month and "TipNet Budget (yearly)" $20/year, both granting that benefit.
- Checkout links (Products > Checkout Links), return URL https://tipmynet.com/. They are in `app/js/billing-config.js` with the organization id and benefit id (all public, not secrets).
- Customer portal: https://polar.sh/tipnet/portal ("Manage subscription" in the Budget tab opens it).

Keep the license-key benefit's device limit at 3. Never turn it off or leave it blank: TipNet unlocks a phone by activating the key on it, and Polar only allows activation on keys that have a device limit, so without one nobody could unlock Budget. The limit is also what stops one key being shared on many phones.

## Important: don't edit the app on GitHub's website
Edit files in the `tipnet` folder on your computer (any text editor, such as Notepad), then use GitHub Desktop to commit and push, as in DEPLOY.md. Editing on the GitHub website at the same time as the copy on your computer creates conflicts.

## Testing a purchase without paying
1. In the Polar dashboard, Products > Discounts: make a 100% discount with a code, "Once", maximum 1 redemption.
2. In TipNet: Budget > tap a price, enter the code on Polar's page, finish with your email (total $0).
3. Paste the emailed key into Budget and tap "Unlock with key". Also try "Remove from this device".
4. The code only covers the first period: cancel the test subscription in the portal afterwards unless you want to keep it.

## How customers get their key
- Right after paying, Polar emails a receipt that includes the license key.
- They can also open https://polar.sh/tipnet/portal with the same email to see their orders, key and devices.
- In TipNet they open Budget, paste the key, and tap "Unlock with key". This needs a connection once. After that it works offline, and the app quietly rechecks about once a day when online. If a phone is offline for more than 14 days the add-on locks until it is online again. The free app is never locked.

## Cancellations and refunds
- TipNet's terms: customers can cancel any time; no refunds. Polar's own buyer terms, and any rights local law gives the customer, still apply.
- Cancel: customers cancel in the customer portal (the link is in their receipt email). They keep access until the end of the period they paid for; then Polar revokes the key and Budget locks on the next recheck. You can also cancel a subscription for them in the Polar dashboard.
- If you ever refund an order in the Polar dashboard, Polar revokes its key and Budget locks on the next recheck (or after the 14-day offline grace if the phone is offline).
- If a customer is stuck at the device limit, they can remove a device in the portal, tap "Remove from this device" (bottom of the Budget tab) on the old device, or you can remove the activation in the Polar dashboard (Benefits > the license key > its grant).

## Privacy note
TipNet sends only the license key and a random device name to Polar, and only when someone activates or once a day to recheck. No budget, pay or night data ever leaves the phone. The Privacy page says this and names Polar.

## Changing the price later (planned: $3.99/month and $30/year from January 1, 2027)
1. In Polar, change the product prices (decide first whether existing subscribers keep their launch price).
2. In `app/js/billing-config.js`, update `prices` so the app shows the same numbers. Also change the written prices in README.md (Budget section), STAFF-GUIDE.md and the first paragraph of this file.
3. Bump `VERSION` in `app/sw.js`, commit and push.

## Lemon Squeezy (the unused alternative)
Lemon Squeezy was the first choice but never approved the store. The app still supports it: `app/js/billing-config.js` keeps a commented Lemon Squeezy block at the bottom. To switch back you would need an approved Lemon Squeezy store, a product with monthly and yearly variants that generate license keys (activation limit 3), its checkout links (containing `/checkout/buy/`, never `?cart=`) and its product id; then replace the `BILLING` block, put the Lemon Squeezy wording back in the page text of `app/privacy.html` and `app/terms.html` (the `data-provider-name`, `data-provider-cancel` and `data-provider-privacy` spots: legal.js only corrects them when JavaScript runs), set their "Last updated" dates, bump `VERSION`, and push.
- Switching providers locks every payer of the other provider: their Budget locks at its next daily check (their key is checked with the new provider, which does not know it). Only switch when nobody pays through the old one yet, or tell those payers first.
- Keys from one provider never unlock under the other.
