# Turning on payments (TipNet Budget)

TipNet stays free. The budgeting add-on costs $1.99 a month or $20 a year. Customers pay through Lemon Squeezy, which gives them a license key. They paste the key into TipNet and the add-on unlocks. You run no server. Until you finish these steps the add-on stays hidden and the app never contacts any payment service.

## What Lemon Squeezy does for you
- It is the "merchant of record": it sells to your customers, collects and pays sales tax and VAT worldwide, and handles receipts and chargebacks. You do not register for sales tax.
- Fees are about 5% + 50 cents per sale (check their pricing page, it can change). On a $1.99 month that is roughly $0.60, so you keep about $1.39. On $20 a year you keep about $18.50.
- Payouts go to your bank account or PayPal. They pay out on a schedule once you pass a small minimum balance.

## Important: don't edit the app on GitHub's website
Edit files in the `tipnet` folder on your computer (any text editor, such as Notepad), then use GitHub Desktop to commit and push, as in DEPLOY.md. Editing on the GitHub website at the same time as the copy on your computer creates conflicts. If someone is helping you with the code, just send them the links and product ID and let them make the change.

## Phase 1: Account and store
1. Go to lemonsqueezy.com and click Sign up. Confirm your email.
2. Create your store. Pick a store name (customers see it on receipts) and United States / USD.
3. A new store starts in **test mode**. That is what you want for now: test mode lets you try everything with a test card, and nobody is charged.

## Phase 2: Create the product (in test mode)
1. Click Products, then New product.
2. Name it exactly: TipNet Budget. Add a one-line description, for example "Plan bills, spending and savings around your estimated take-home."
3. Set Pricing to Subscription.
4. The first price is your first variant: name it "Monthly", $1.99, billed every 1 month.
5. Add a variant: name it "Yearly", $20, billed every 1 year.
6. On each variant, turn on "Generate license keys" and set the activation limit to 3 (one key works on up to 3 devices). Subscriptions have no license length setting: the key stays active while the subscription is paid and expires when it ends.
7. Save the product and make sure its status is Published.

## Phase 3: Put the details into TipNet and test
1. Get each checkout link: open TipNet Budget, click Share, pick the variant, copy the link. It must contain `/checkout/buy/`. Never copy the address of an open checkout page: links with `?cart=` in them only work once.
2. Find the product ID: the number for TipNet Budget, usually shown in the web address when the product is open. (Stuck? A test license key also reveals it: the key check Lemon Squeezy offers returns the product ID.)
3. In `app/js/billing-config.js`:
   - Paste the Monthly link between the quote marks on `monthly: '',` and the Yearly link on `yearly: '',`.
   - Put the product ID in the brackets: `productIds: [123456],`. Required: while the brackets are empty, payments stay off, so a key from someone else's store can never unlock Budget.
   - Change `provider: null,` to `provider: 'lemonsqueezy',`.
   - For testing only, change `allowTestMode: false,` to `allowTestMode: true,` (TipNet refuses test keys otherwise).
4. Test on your own computer before publishing anything: run the app locally (README, "On your own computer"), open Budget, tap the Monthly button, and pay with the test card 4242 4242 4242 4242, any future expiry date and any 3-digit code. Lemon Squeezy emails you a test license key. Paste it into Budget and tap "Unlock with key". Also try "Remove from this device".

## Phase 4: Activate your store
1. In Lemon Squeezy, follow the steps to activate your store: a short questionnaire about your business and customers, and an identity check. Approval usually takes a few business days.
2. When it asks for your website, use https://sjeanpierrepro.github.io/tipnet/ . Make sure the current version of the app (with the Privacy and Terms pages) is published first.
3. Set up payouts (bank or PayPal) when asked.

## Phase 5: Go live
1. Turn test mode off. Open TipNet Budget and use "Copy to Live Mode" (test products don't carry over by themselves).
2. Get the live Monthly and Yearly links and the live product ID (they differ from the test ones) and put them into `app/js/billing-config.js` as in Phase 3.
3. **Set `allowTestMode` back to `false`.** With it on, free test keys from anyone's test store would unlock Budget.
4. In `app/sw.js`, increase the number at the end of the `VERSION` line by one (for example `tipnet-v25` becomes `tipnet-v26`; always one higher than what is there now). Installed apps only fetch your changes when this number changes, and the publishing check fails if you forget.
5. Commit and push with GitHub Desktop. The site rebuilds in a minute or two; customers get the update the next time they open the app and tap Refresh.
6. Before the first real sale: have the Privacy and Terms pages reviewed, and check that the support email on Lemon Squeezy's receipts is the one you want customers to write to.

## How customers get their key
- Right after paying, Lemon Squeezy emails a receipt that includes the license key.
- They can also log in any time at app.lemonsqueezy.com/my-orders with the same email to see their orders and key.
- In TipNet they open Budget, paste the key, and tap "Unlock with key". This needs a connection once. After that it works offline, and the app quietly rechecks about once a day when online. If a phone is offline for more than 14 days the add-on locks until it is online again. The free app is never locked.

## Cancellations and refunds
- TipNet's terms: customers can cancel any time; no refunds. Lemon Squeezy's own buyer terms, and any rights local law gives the customer, still apply.
- Cancel: customers cancel from the link in their receipt email or on their My Orders page. They keep access until the end of the period they paid for; then the key expires and Budget locks on the next recheck. You can also cancel a subscription for them under Subscriptions.
- If you ever do refund an order (Orders > open the order > Refund), also disable its license key under Licenses so Budget locks on the next recheck.
- If a customer is stuck at the device limit, remove a device under Licenses > open the key > Instances, or they can tap "Remove from this device" (bottom of the Budget tab) on the old device.

## Privacy note
TipNet sends only the license key and a random device name to Lemon Squeezy, and only when someone activates or once a day to recheck. No budget, pay or night data ever leaves the phone. The Privacy page already says this.
