# TipNet

TipNet is a free app that helps bartenders see their estimated take-home pay at the end of a shift. You enter your tips for the night and the hours you worked (TipNet adds your hourly pay), and it shows how much cash you're taking home and how much will appear on your paycheck after taxes and deductions.

All the numbers stay on your phone or computer. Your bar cannot see them. No accounts to create. Your pay and budget data never leave your device; the only thing TipNet ever sends is a license key check to Lemon Squeezy, and only if you use the paid Budget add-on.

## What you can do with TipNet

- **Record your shift**: Type your tips (cash + card) and your hours; TipNet adds your hourly pay. Prefer typing everything (tips plus hourly pay)? Switch "The number I type each night is" in Setup. Saved nights never change when you switch.
- **Start with your paystub**: A new install opens in Setup. Tonight and Pay periods show no numbers until setup is done (or a backup is restored), so no estimate is ever based on example taxes. "See an example first" shows made-up numbers, clearly marked.
- **See your split**: Find out instantly how much is cash in hand and how much hits your check.
- **Set up once**: Tell TipNet about your pay schedule (weekly, every two weeks, twice a month, or monthly), your gross pay, and your deductions (taxes, health insurance, etc.).
- **Work at more than one restaurant**: In Setup, tap **+ Set up another restaurant**, give it a name and go through the same three steps with a paystub from there. Each restaurant keeps its own pay schedule, paystub, jobs, tip-out, entry style and accuracy history. On Tonight, a row of restaurant buttons at the top switches everything with one tap (a half-typed entry at each restaurant is kept), and the restaurant you used last opens next time. Pay periods can show all restaurants or one, and Budget counts every restaurant's paychecks. Late nights, appearance and backups are shared. With one restaurant nothing changes.
- **Setup stays tidy**: once set up, Setup shows each restaurant as one line with a short summary. Tap it to edit, then **Save** (or **Cancel**); leaving with unsaved changes asks first. Shared settings are one line each and apply right away.
- **Non-taxable earnings**: reimbursements and allowances your stub lists as non-taxable are left out of the tax rate; the ones on every check are added to your estimate without tax.
- **Track accuracy**: At the end of a pay period, enter your actual paycheck and let TipNet learn. Each check you compare brings the next estimate closer.
- **Install like an app**: Tap "Install to home screen" in your browser. It works on iPhone, Android, Windows, and Mac.

## How to run TipNet

### On your phone or computer
Open the link your bar gives you. The first time, you may see a prompt to "Install app" or "Add to home screen"—tap it. After that, open it from your home screen or desktop like any app. It works offline.

### On your own computer (testing or setup)
You need Node 20.19 or newer 20.x, 22.13 or newer 22.x, or Node 24 or higher (the "engines" line in package.json). In your terminal, from the TipNet folder, first install test dependencies once:

```
npm ci
```

Then run all the tests:

```
npm test
```

To check that no test depends on today's date, run the same tests as if today were a few awkward dates (right after a pay period ends, New Year's Day, a leap day, January 31 and the March daylight-saving switch). The publishing check runs this too:

```
npm run test:dates
```

(`npm test` runs `tests/**/*.test.js`; the date check is tools/run-dates.mjs and prints the test count per date.)

To see TipNet running locally:

```
npx --yes serve app
```

Then open the address it prints (like `http://localhost:3000`).

A plain refresh does **not** always show your changes, because the service worker serves the saved copy of the app. After an update is deployed, the app shows "Update available: Refresh"; tap it to load the new version. For local development, either bump `VERSION` in `app/sw.js`, or open DevTools > Application > Service workers and tick **Update on reload**.

## How to deploy TipNet

See [DEPLOY.md](DEPLOY.md) for click-by-click steps. You have two free options:

1. **GitHub Pages** (takes 5 minutes, requires a free GitHub account)
2. **Netlify Drop** (drag and drop; make a free account to keep the link)

Both give you an https link that works on any device.

## Project folders

- `app/` — the TipNet website. Everything you deploy goes here.
- `tests/` — automated tests: the money math, storage, budget and the screens.
- `tools/` — build and check scripts (make-icons.ps1, check-version.mjs, run-dates.mjs, and fake-today.mjs, which run-dates preloads to fake the date).
- `app/js/math.js` — pure math functions (no buttons or screens). This is what the tests check.
- `integrations/` — the "Toast seam" (kept outside `app/` so it isn't published). Today TipNet imports any CSV file (Setup > Import nights). Toast has no built-in support yet: once a real Toast export is available, it becomes a saved column preset in `app/js/csv.js` (see `integrations/README.md`). A live Toast connection would need a server and is not part of this app.
- `archive/` — the original approved prototype, kept for reference.

## How your staff installs TipNet

See [STAFF-GUIDE.md](STAFF-GUIDE.md) for a one-page printable guide. It covers:

- Opening the link
- Installing to home screen (iPhone, Android, Windows, Mac)
- Setting up with your paystub
- Using it every night

## What devices it works on

TipNet is built for current versions of Safari (iPhone and Mac), Chrome (Android, Windows, Mac), Edge, and Firefox.

**What was and was not tested**: The money math is covered by automated tests (`npm test`). The screens were checked in a desktop Chromium browser at phone and desktop sizes, in both themes. The service worker was verified in desktop Chrome on Windows 11: it registers, the app works offline after the local server is stopped, the install prompt fires, and the update bar appears after a `VERSION` bump.

**Not tested**: a Lighthouse audit, actually installing the app, iPhone Safari, Android Chrome, Edge, and macOS. TipNet is deployed on GitHub Pages, but the live site has not been checked on real phones yet. Before the pilot, install it on one iPhone and one Android phone, turn on airplane mode, and reopen it to confirm it works offline.

## Releasing an update

When you change any file in `app/`, also change the `VERSION` line at the top of `app/sw.js` (for example `tipnet-v2` to `tipnet-v3`). That is how phones learn there is a new version; they then show "Update available: Refresh". The one exception is `app/js/billing-config.js` on its own (switching payments on): installed apps refresh it in the background, so the bump is optional there, though still recommended.

## Privacy

Your numbers stay on your device. A Content Security Policy in `app/index.html` makes the browser enforce that TipNet only talks to its own site. If you use the optional Budget add-on, TipNet sends only your license key and a random device name to Lemon Squeezy (once when you activate the key, and about once a day to check it is still valid). Your pay data and budget never leave your device.

## Legal

Changing the contact email: edit `CONTACT_EMAIL` in `app/js/legal.js` (the Privacy and Terms pages show it), then bump `VERSION` in `app/sw.js` and push.

TipNet gives estimates, not tax advice. Your numbers stay on your device. It does not collect your name, Social Security number, or any personal information beyond what you voluntarily type into it.

## Budget (optional paid add-on)
The Budget tab helps plan money between paychecks: "safe to spend until payday", next paycheck, bills, spending categories and savings goals. With more than one restaurant it counts all of them: safe to spend runs until the next check from any restaurant (and says whose), the after-payday view lists each check that arrives, and each goal is saved from one restaurant's paychecks ("Save from which paycheck?"). It costs $1.99 a month or $20 a year; everything else in TipNet stays free. Budget data stays on the device like everything else.

A calm **TipNet Budget** card at the bottom of Tonight, Pay periods and Setup shows the price and opens a preview of Budget ("Coming soon" while payments are off); it disappears once Budget is unlocked on that device. The Budget tab itself is hidden until you switch on payments (in `app/js/billing-config.js`; click-by-click steps are in `PAYMENTS.md`). Once payments are on, customers can buy a license key and paste it into the Budget tab to unlock the feature.

To try it locally, open the app on localhost with `?unlock=dev` on the end of the address.
