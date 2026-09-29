# TipNet

TipNet is a free app that helps bartenders see their estimated take-home pay at the end of a shift. You enter one number—everything you made that night—and it shows how much cash you're taking home and how much will appear on your paycheck after taxes and deductions.

All the numbers stay on your phone or computer. Your bar cannot see them. No accounts to create, no data sent anywhere.

## What you can do with TipNet

- **Record your shift**: Type what you made (tips, hourly pay, everything) and how much cash you're carrying home.
- **See your split**: Find out instantly how much is cash in hand and how much hits your check.
- **Set up once**: Tell TipNet about your pay schedule (weekly, every two weeks, twice a month, or monthly), your gross pay, and your deductions (taxes, health insurance, etc.).
- **Track accuracy**: At the end of a pay period, enter your actual paycheck and let TipNet learn. Each check you compare brings the next estimate closer.
- **Install like an app**: Tap "Install to home screen" in your browser. It works on iPhone, Android, Windows, and Mac.

## How to run TipNet

### On your phone or computer
Open the link your bar gives you. The first time, you may see a prompt to "Install app" or "Add to home screen"—tap it. After that, open it from your home screen or desktop like any app. It works offline.

### On your own computer (testing or setup)
You need Node 20 or higher. In your terminal, from the TipNet folder:

```
npm test
```

This runs all the money math tests.

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
- `tests/` — unit tests for all the money math.
- `app/js/math.js` — pure math functions (no buttons or screens). This is what the tests check.
- `app/js/integrations/` — the "Toast seam". Today TipNet imports any CSV file (Setup > Import nights). Toast has no built-in support yet: once a real Toast export is available, it becomes a saved column preset in `app/js/csv.js` (see `app/js/integrations/README.md`). A live Toast connection would need a server and is not part of this app.

## How your staff installs TipNet

See [STAFF-GUIDE.md](STAFF-GUIDE.md) for a one-page printable guide. It covers:

- Opening the link
- Installing to home screen (iPhone, Android, Windows, Mac)
- Setting up with your paystub
- Using it every night

## What devices it works on

TipNet is built for current versions of Safari (iPhone and Mac), Chrome (Android, Windows, Mac), Edge, and Firefox.

**What was and was not tested**: The money math is covered by automated tests (`npm test`). The screens were checked in a desktop Chromium browser at phone and desktop sizes, in both themes. The service worker was verified in desktop Chrome on Windows 11: it registers, the app works offline after the local server is stopped, the install prompt fires, and the update bar appears after a `VERSION` bump.

**Not tested**: a Lighthouse audit, actually installing the app, iPhone Safari, Android Chrome, Edge, macOS, and a real GitHub Pages deploy. Before the pilot, install it on one iPhone and one Android phone, turn on airplane mode, and reopen it to confirm it works offline.

## Releasing an update

When you change any file in `app/`, also change the `VERSION` line at the top of `app/sw.js` (for example `tipnet-v1` to `tipnet-v2`). That is how phones learn there is a new version; they then show "Update available: Refresh".

## Legal

TipNet gives estimates, not tax advice. Your numbers stay on your device. It does not collect your name, Social Security number, or any personal information beyond what you voluntarily type into it.
