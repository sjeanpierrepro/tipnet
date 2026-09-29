# Turning on payments (TipNet Budget)

TipNet stays free. The budgeting add-on costs $1.99 a month or $20 a year. Customers pay through Lemon Squeezy, which gives them a license key. They paste the key into TipNet and the add-on unlocks. You run no server. Until you finish these steps the add-on stays locked and the app never contacts any payment service.

## What Lemon Squeezy does for you
- It is the "merchant of record": it sells to your customers, collects and pays sales tax and VAT worldwide, and handles receipts and chargebacks. You do not register for sales tax.
- Fees are about 5% + 50 cents per sale (check their pricing page, it can change). On a $1.99 month that is roughly $0.60, so you keep about $1.39. On $20 a year you keep about $18.50.
- Payouts go to your bank account or PayPal. Set this up under Settings > Payouts. They pay out on a schedule once you pass a small minimum balance.

## Set up, click by click
1. Go to lemonsqueezy.com and click Sign up. Confirm your email.
2. Create your store when asked. Pick a store name (customers see it) and your country and currency (USD).
3. Finish the payout and identity details Lemon Squeezy asks for under Settings. You cannot take real payments until this is approved.
4. Click Products in the left menu, then New product.
5. Name it exactly: TipNet Budget. Add a short description. Set Pricing to Subscription.
6. Set the first price to $1.99 billed every 1 month. This is your first variant. Name the variant "Monthly".
7. Add a second variant: click Add variant, name it "Yearly", price $20, billed every 1 year.
8. On each variant, scroll to License keys and turn on "Generate license keys". Set Activation limit to 3 (one key can be used on 3 devices, for example phone, tablet and a second phone). Leave key length as is. Leave the license length matched to the subscription (the default).
9. Save the product. Publish it (the status must be Published, not Draft).
10. Get the checkout links: on the Products page open TipNet Budget, click the "..." next to each variant, choose Share, and copy the checkout link.
11. Open the file `app/js/billing-config.js` on GitHub (click the pencil icon to edit).
    - Paste the Monthly link between the quote marks on the line `monthly: '',` under `checkout`.
    - Paste the Yearly link on the `yearly: '',` line.
    - Optional but recommended: in Lemon Squeezy, open the product; the number in its web address is the product id. Type it inside the brackets on the `productIds: [],` line, for example `productIds: [123456],`. This stops keys from any other store working.
    - Change `provider: null,` to `provider: 'lemonsqueezy',`.
12. Commit the change. The site rebuilds in a minute or two. Customers get the update the next time they open the app and tap Refresh.

## Test first (recommended)
Lemon Squeezy has a Test mode switch at the top of the dashboard. Turn it on, and repeat steps 4 to 10 there (test mode has its own products and links). Use the test checkout link in `billing-config.js`, and pay with card number 4242 4242 4242 4242, any future expiry date and any 3 digit code. You will get a test license key by email. Paste it into TipNet to see the add-on unlock. When you are happy, turn Test mode off, create the real products, and swap in the real links and product id.

## How customers get their key
- Right after paying, Lemon Squeezy emails a receipt that includes the license key.
- They can also log in any time at app.lemonsqueezy.com/my-orders with the same email to see their orders and key.
- In TipNet they open the budgeting add-on, paste the key, and tap Activate. This needs a connection once. After that it works offline, and the app quietly rechecks about once a day when online. If a phone is offline for more than 14 days the add-on locks until it is online again. The free app is never locked.

## Refunds and cancellations
- Refund: Lemon Squeezy dashboard > Orders > open the order > Refund. The key is turned off and the add-on locks on that customer's device the next time it rechecks.
- Cancel: customers cancel themselves from the link in their receipt email or My Orders page. They keep access until the end of the period they paid for. You can also cancel a subscription for them under Subscriptions.
- If a customer is stuck at the device limit, you can remove a device under Licenses > open the key > Instances, or they can tap "Remove this device" in TipNet on the old device.

## Privacy note
TipNet sends only the license key and a random device name to Lemon Squeezy, and only when someone activates or once a day to recheck. No budget, pay or night data ever leaves the phone. Mention this in your privacy notice.
