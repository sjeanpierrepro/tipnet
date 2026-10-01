
## Shell, styling, PWA (scaffold worker)
- Fonts: WOFF2 latin subset from fonts.gstatic. Big Shoulders Display and Figtree are variable fonts (one file each, weight ranges 700-800 / 400-700); IBM Plex Mono only the 500 weight. Total ~70 KB.
- Light theme brass is darker (#8C6718 accent, #7A5810 hero) so it passes AA on light backgrounds; dark uses #C9A45C / #D6B46E.
- Theme: html[data-theme] set before first paint by js/theme-boot.js (a small synchronous external script, since the CSP blocks inline scripts) from localStorage key "tipnet-theme". Setup UI writes that key too.
- Icons: T monogram in brass on #121417; PNGs generated with System.Drawing via app/icons/make-icons.ps1 (no node on this machine). Maskable uses 0.8 scale for the safe zone. Manifest uses relative start_url/scope for GitHub Pages subpaths.
- Service worker: cache-first (except js/billing-config.js, network-first with a 4 s / offline cache fallback so turning payments on reaches installed apps), precaches each file individually (a missing file does not fail install). Accepts 'SKIP_WAITING' string or {type:'SKIP_WAITING'}. Bump VERSION each release.
- Deploy workflow runs `npm test` then `npm run test:dates` and needs a package.json with those scripts at repo root.
- Logic layer: money is rounded to whole cents per night (tax, tip-out, fixed share are each rounded), so period sums are exact cent sums; results can differ from unrounded prototype math by a cent.
- Logic layer: package.json test script is `node --test "tests/**/*.test.js"` (a quoted glob: Node expands it itself, so it works the same in PowerShell, cmd and Linux CI; a bare directory argument is treated as a module path on Node 22). The date runner is tools/run-dates.mjs, deliberately not named test-*: a plain `node --test` used to pick it up, skip its nested runs and still report a pass. It now counts tests per date and fails on any failure, skip, or zero tests.
- Logic layer: computeNight/periodTotals/calibrate take profile and nights explicitly plus an injectable `today`; shiftsPerPeriod returns {n, source}.
- Logic layer: calibrate() does not mutate; the UI stores {label,pred,actual,err} and sets profile.rateOverride from the result.
- Logic layer: CSV rows on the same date are summed into one night; saved CSV mapping stores header names (settings.csvMapping), not column indexes.
- Logic layer: migrate() also fills missing tipout/freq/shifts/settings defaults and returns a new object (input is not mutated); backup codes use the same base64-of-UTF-8-JSON format as the prototype.

## UI layer
- UI: money fields are type=text with inputmode=decimal (not type=number) so "$1,200" pastes cleanly; values are cleaned before math.
- UI: example mode (example profile AND example nights) pre-fills Tonight with the spec night ($585, 8 hours, $210 cash = $420.46) so the first screen shows a real result. The pre-fill is dropped as soon as example mode ends (first save, Finish setup, Clear example nights); the fresh draft leaves cash blank and main-rate hours fall back to the user's usual hours. Erase everything and Restore also clear the draft and the Pay periods editor/accuracy message.
- UI: guided setup shows while the profile is still the example and setup was not skipped/finished; it stays active after the first edit (which ends example mode) until Finish or Skip. Step 1 blocks Next only on missing start date or gross pay.
- UI: Edit night opens an inline form in Pay periods (same fields as Tonight); one editor at a time.
- UI: Restore asks for a second tap only when real (non-example) nights exist; Erase always needs two taps.
- UI: CSV import treats the Cash column as cash in hand, requires picking your own name when an Employee column is mapped, and uses the main pay type's rate for hours x rate.
- UI: sw.js precache requests use cache:'reload' so a new VERSION never caches stale HTTP-cached files; activate only deletes caches named tipnet-* because a github.io origin is shared with the owner's other Pages sites.
- UI: theme stored in settings.theme and mirrored to localStorage "tipnet-theme" (auto removes the key).
- Two-column Setup fields stack into one column below 380 px wide, so dates and dropdowns are not cut off on small Android phones.

## Final review
- Bonuses/commissions use the 22% federal supplemental rate; some payroll companies instead add bonuses to regular pay (aggregate method), which would change withholding.
- applyPayPreset: only Overtime autofills its rate (1.5x the main rate), matching the prototype. Every other preset leaves the rate for the user to type (covered by a regression test).
- CSV import "overwrite" updates the existing night: keeps its id and barback choice, keeps its cash when the import has no cash, and keeps pay types the import does not mention.
- "You get paid" is always usable: choosing a schedule moves the end date to match (start + length - 1); if the dates disagree with the schedule, a note says the dates win. Replaces disabling the dropdown, which read as broken.

## Payments (budgeting add-on)
- Price: $1.99/month or $20/year. Provider: Lemon Squeezy (merchant of record, license keys). Code is provider-agnostic (interface in app/js/billing.js, chosen in app/js/billing-config.js). No server of our own.
- CORS check (2026-09-29, curl): OPTIONS preflight to api.lemonsqueezy.com/v1/licenses/activate returned 204 with access-control-allow-origin: *, allow-methods including POST, allow-headers Content-Type. A POST to /validate with an Origin header and a fake key returned 404 JSON {"valid":false,"error":"license_key not found."} with access-control-allow-origin: *. Browsers can call it directly, so direct calls are used and there is no proxy. The old proxy/lemonsqueezy-worker.js was deleted (deployed as written it would have been an open relay; see git history if one is ever needed, and restrict it to POST on the 3 license endpoints, an allow-listed Origin and the license_key/instance_id/instance_name fields). The proxyUrl config field stays only for the case that browsers ever block direct calls.
- Deliberate exception to "no third-party calls": the app calls api.lemonsqueezy.com only when the user activates a key, or when a silent revalidation is due (at most once per 24 hours, online only, only if a key is stored). It sends only the license key and a random device name, never budget, pay or night data. The free app never calls it.
- Entitlement lives in state.settings.entitlement {plan, key (full; masked for display with maskKey), instanceId, status, validatedAt, expiresAt}. Unlocked = active/on_trial and validated within 14 days (offline grace). A network failure never locks anyone; only a definite provider answer (expired, disabled, not found) does.
- Dev unlock: ?unlock=dev works only on localhost/127.0.0.1 and gives {plan:'dev'}.
- The service worker handles only same-origin requests, so provider responses are never cached.

## Budget tab (paid add-on UI)
- Budget is the 4th tab (Tonight, Pay periods, Budget, Setup). Locked users see a plain-words explanation, a blurred sample labelled "Example" (made-up numbers from exampleBudget), the two prices, and a license-key field. If payments are not configured the buy buttons are disabled with "Payments aren't switched on yet." Nothing about Budget appears on the free tabs except one quiet line in Setup > Backup for people who already have a subscription.
- state.budget is normalized by migrateBudget inside storage migrate(), so old saves and old backup codes get an empty budget. Backup codes include budget.
- Backup codes deliberately exclude settings.entitlement (the license key): codes get pasted into notes and chats, and a key in a code would let it be shared. Restore and Erase everything keep this device's own entitlement.
- "Money you have right now" is not saved (this visit only) so a stale balance is never used later. Blank means cash tips this pay period minus spending logged this period (so logging spending never raises safe to spend). The input sits above the result.
- Projected check scales only from nights with cash entered (check = take-home - cash); with none, it uses the average check of finished periods where every night has cash, else shows "Not known yet" (never total take-home, which would count cash twice).
- Payday is taken as the day after the pay period ends (no pay-date lag setting yet); the breakdown says so.
- Provider 5xx/429 replies count as network failures (grace applies), never as a lock. A stored dev entitlement is deleted at boot on any host other than localhost/127.0.0.1. Plan (monthly/yearly) is read from the Lemon Squeezy variant name.
- Negative safe-to-spend is shown as a plain number with a calm explanation, no red.
- Bills tick "Paid" per pay period (key periodIndex:billId). Past-due unpaid bills in the current period keep counting, as in budget.js. Deleting a bill also removes its paid marks; deleting a category keeps its logged spending (shown as "Other").
- Silent revalidate runs at boot and on the browser "online" event; the screen re-renders only if the locked state changed, so typing is never interrupted. Dev unlock (?unlock=dev on localhost) stores a plan "dev" entitlement.
- The sample card uses $2,400 as the example cash so the example is positive.
- sw.js VERSION bumped to tipnet-v7.

## Pay delay (payday date)
- profile.payDelay = whole days after the pay period END that the check arrives, 0-21. Absent/blank/garbage = 1 (day after end, the old behaviour). storage migrate clamps it and leaves it absent when unset; budget.js payDelayOf() is the single reader.
- Setup asks for a date ("Payday for this pay period", optional, in the pay period card on both the guided step 1 and the returning-user page) and stores the day count relative to the period end, so the date moves with the period dates. Dates before the period end or more than 21 days after show an inline error and are not saved.
- nextPayday is the first pay date strictly after today. Between a period's end and its payday it belongs to the PREVIOUS (finished) period. safeToSpend then counts unpaid bills due up to the day before that payday, and "after" covers payday until the day before the following payday. Its projected check is that finished period's check (periodTotals chk, else the average past check, else unknown), not the current period's projection.
- Budget shows one calm line under the hero, with a link to Setup, while payDelay is unset. sw.js VERSION bumped to tipnet-v8.

## Content Security Policy
- app/index.html carries a meta CSP (first element after charset): default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; connect-src 'self' https://api.lemonsqueezy.com; base-uri 'none'; form-action 'none'; object-src 'none'. The browser now enforces "talks only to itself and Lemon Squeezy".
- frame-ancestors cannot be set through a meta tag; it needs an HTTP header, which GitHub Pages does not allow. Clickjacking protection is therefore not covered.
- The inline theme script moved to js/theme-boot.js (classic script, loaded synchronously before the CSS so there is no flash) and is precached in sw.js. The noscript inline style became a .noscript class. JS style use goes through element.style / cssText (CSSOM), which CSP allows; no style attributes appear in HTML strings.
- If billing-config.js proxyUrl is ever set, its origin MUST be added to connect-src or license checks will be blocked.
- Verified in Chrome on localhost: zero violations across all tabs, setup, CSV import, backup, theme toggle, Budget; SW registers and the app loads offline; fetch/Image to example.com are blocked, a fetch to api.lemonsqueezy.com/v1/licenses/validate is allowed (404 JSON for a fake key).
- Tonight live preview treats a negative or non-numeric total as empty (shows the usual "Enter tonight's total" note). Deleting a bill now offers the 5-second Undo toast (restores the bill and its paid marks). sw.js VERSION bumped to tipnet-v10.

## Calendar pay periods (twice a month, once a month)
- Six options, stored in profile.freq: 7, 14, 15 and 30 are fixed-length days (exactly the pre-calendar behavior, so existing data and prototype backup codes that store 15/30 keep their meaning; no migration of 15/30). 'semimonthly' (Twice a month) and 'monthly' (Once a month) follow the calendar. Lengths for the string modes never come from num(freq). storage.migrate accepts those six values (a numeric string like "15" becomes the number) and resets anything else to 14.
- Twice a month ('semimonthly'; the Setup label shows the real anchors, e.g. 5th–19th and 20th–4th): anchors are day A = day of periodStart and B = A+15 (A <= 15) or A-15 (A > 15), so 1 -> 1/16, 5 -> 5/20, 16 -> 16/1. A period runs from one anchor to the day before the next; an anchor past the end of a short month is clamped to its last day. Once a month: the anchor is A each month, clamped the same way.
- Rule: when freq is 'semimonthly' or 'monthly' the calendar wins. periodEnd is ignored by the math (lengthFromDates is false) and Setup auto-sets the end date (calendar modes: the derived end; fixed modes: start+length-1, and the end-date-wins note applies as before) of the first period (choosing the frequency, editing the start, or finishing an end-date edit). No "Your dates make the pay period N days long" note in this mode; a calendar note is shown instead. Existing profiles with a stale start+14 end date keep working: the stored end is simply not used.
- periodLength(p, idx) is now per period (idx defaults to 0); periodIndex/periodRange work for negative indexes. shiftsPerPeriod, periodTotals and calibrate take/derive the index so the 4-shifts-a-week default uses that period's length (e.g. 13-day Feb half = 7 shifts). Summary shows "twice a month (e.g. the 1st-15th and 16th-end)" instead of "N days". No storage schema change.
- sw.js VERSION bumped to tipnet-v11, then tipnet-v12 when both fixed and calendar options were offered.

## Final review fixes
- Between a period's end and its payday, the projected check uses the finished period's check only when every night has cash; otherwise it scales from nights with cash (sum of onCheck + fixed share, times N / nights with cash, minus fixed deductions), then the average past check, else "Not known yet". safeToSpend().after.checkFrom tells the UI which it used.
- paydayInfo steps back from the current period until the previous check has already arrived, so short periods with long pay delays are right in every frequency mode.
- revalidate stores 'invalid' (locked) when the provider answers valid:false but the key status is still active (for example an instance removed on the dashboard).
- The Bills card lists bills through the end of the Next paycheck window, so it never omits a bill that card counts.
- sw.js VERSION bumped to tipnet-v13.
- A backup or saved state with a missing/broken pay period start date is repaired to today on load; payday search loops are capped so bad data can never freeze the Budget tab. billing-config.js falls back to the cached copy when the host returns an error, not just when offline.
- Backup codes never carry a subscription; restoring keeps this device's own unlock or none. An unlock needs a license key and a device instance id, and payments switched on; a "last checked" time in the future is rejected.
- Damaged saved data or backup codes are cleaned on load: bad rows are dropped, bad fields reset, so the app always opens. The error screen has its own Restore and Erase buttons.
- After every screen update, keyboard/screen-reader focus returns to the same control.
- The Budget tab is hidden until payments are switched on, unless this device already has an unlock.
- A mistyped license key says "not found"; "not for TipNet Budget" only when Lemon Squeezy found the key under another product.
- The app loads whichever saved copy (IndexedDB or localStorage) is newer.
- "Check my accuracy" only compares finished pay periods and picks the newest finished one by default.
- Pay period math builds one period-to-nights index per screen, so screens stay fast with years of nights (1,000 nights: 86 s → 22 ms in tests).
- Dates outside the years 1000–9998 are rejected.
- Bill "Paid" ticks are keyed by bill and due date, so they survive pay-schedule changes; old ticks are converted when the app loads.
- "Money you have right now" is saved with the time it was entered; spending logged after that time is subtracted; after 3 days the app suggests updating it.
- Undo after deleting a deduction, spending category or savings goal.
- Example data is dated relative to today.
- Negative cash, or cash more than the night's total, isn't used or saved; the night still saves. Spreadsheet rows with negative amounts are skipped with a reason.
- Shifts logged before 6 a.m. count as the night before by default; changeable in Setup ("Late nights", 12 a.m. = off, up to 8 a.m.).
- Example nights never count as shift history.
- Wording: removed the unbacked "usually within 5–10%" claim; state-tax note is general, not Florida-only; tax lines say "Taxes and % deductions" because they include things like 401(k).
- The icon script make-icons.ps1 moved to tools/ so it isn't published with the site.
- The app is live at https://sjeanpierrepro.github.io/tipnet/. The gh command-line tool isn't installed on this computer, so updates are published by pushing from GitHub Desktop (see DEPLOY.md).
- Hosting stays public on GitHub Pages (owner decision). The Budget paywall runs in the browser, so a technical person could unlock it on their own copy; accepted as a business risk at this price.
- A night locks when its pay period ends (not when it's saved), so fixing a Setup mistake still corrects the current period while finished periods never change. Locking runs at start-up, on every screen update, when the app comes back into view, on save, on import, and before any Setup edit is applied.
- "Check my accuracy" works out the usual shift count without the period being checked, so a missed night shows up as missing.
- Code style: Prettier (110-column lines) and ESLint run on every publish; `npm run format` tidies the code.
- The cash box keeps the approved math (cash collected; a barback paid from cash comes out of it) and the labels now say so: "Cash tips collected (before paying the barback)" when the barback is paid from cash, otherwise "Cash you're taking home"; the result shows "Cash you keep".
- Hours accept "7:30" (7.5 hours); more than 24 hours on an hourly pay type is refused; a total below the night's hourly pay gets a gentle warning, not a block.
- Logging a second night on the same date asks: add to that night (the default), replace it, or save a separate night.
- "Check my accuracy" adjusts once per pay period. Redoing the most recent comparison replaces it, starting from the rate before it; an older comparison can't be redone once a later one exists ("Undo adjustments" starts over).
- Budget sets aside spending money day by day: each category's monthly amount divided by the days in that month, for each day until payday, never more than what's left this month.
- Savings goals have a "Set aside for this paycheck" tick; once ticked (or after "Add to saved"), that goal isn't subtracted again until the next payday.
- Payments count as switched on only when billing-config.js has a product ID; Lemon Squeezy test-mode keys are refused unless allowTestMode is true (for the owner's own testing only).
- An update installs all-or-nothing: if any file fails to download, the previous version stays in charge and the browser retries later.
- The publishing check fails if files in app/ changed but the VERSION line in app/sw.js didn't (tools/check-version.mjs).
- Finishing guided setup clears the example nights; setup errors appear only after leaving a field or pressing Next.
- The nightly number is tips only by default (cash + card; TipNet adds the hourly and per-shift pay for the hours entered). Setup has the switch ("The number I type each night is"). Saved nights always store everything made, so math, CSV, backups and accuracy checks are unchanged and switching never changes a saved night.
- Existing installs keep typing totals: a state without the setting gets "Everything" if it has real nights or its own paystub; new installs, erased apps and example-only states get tips. Old backup codes restore as "Everything".
- In tips mode the night editor shows the tips inside the stored total (worked out with the night's locked rates when it has them) and converts back on save; untouched, the stored total is kept exactly. "Add to that night" adds the tips plus the pay for the added hours only, at that night's rates.
- The "total below your hourly pay" warning only shows when typing everything. In tips mode 0 tips is allowed (hourly pay only); blank is not.
- New users start in Setup. Until TipNet is set up (guided setup finished, real nights saved or restored, or the paystub basics entered after "Skip"), Tonight, Pay periods and an unlocked Budget show a "Finish setup" card: no estimate, no Save. "See an example first" shows the example night with a "These are example numbers, not yours" banner.
- "Skip guided setup" swaps the example paystub for a blank one and does not count as set up: Tonight unlocks once gross pay, a deduction (or "My paystub has no deductions") and the main rate are in. Importing nights waits for the same basics.
- Restoring a backup from the first-launch Setup (or the error screen) lands on Tonight; Erase everything returns to the first-launch Setup.
- Jobs (owner request): Setup lists every job the user works (Bartender, Server, Barback, Supervisor / shift lead, Prep, Training, Host, Private event, Other) with its rate; Tonight picks the job(s) worked and the hours, and the rate fills in. Job vs "other pay" (overtime, holiday, differential, PTO, bonus, commission, service charge) is worked out from each pay type's unit and preset; nothing extra is stored. Other pay stays hidden on Tonight until "+ Add other pay".
- Hours are typed every night (owner decision): Setup has no "usual hours" fields, and nothing pre-fills or remembers hours from past nights, because shift lengths and breaks between doubles vary. Every hourly job row with a rate needs hours; per-shift jobs start at 1 shift.
- In tips mode the typed tips are stored on the night, so fixing a job's rate later changes the wages, not the tips, for nights in an unfinished pay period.
- "Check my accuracy" matches earlier comparisons by their start and end dates, so editing Setup dates can't let one pay period adjust twice.
- Spreadsheet import has a "Tips (cash + card)" column choice; headers containing "tip" map to it. "Replace" replaces every night on that date. Hours over 24, or ambiguous like "1,250", skip the row with a reason.
- Budget counts unpaid bills from the last payday (not the pay period start), so a bill stays until it's paid even when payday comes days after the period ends.
- Big-purchase plans: by a date (TipNet works out the amount per paycheck from the real pay schedule, rounded up) or a set amount per paycheck (TipNet works out the ready-by date). A realism line compares the amount with a typical check plus regular other income.
- Other income (outside TipNet) is entered once with its amount, how often and next date; TipNet generates every future date and counts it in Safe to spend and the after-payday view.
- Two open copies of TipNet never overwrite each other: newer saved data is merged in (nights by id, settings key by key) and other windows redraw.
- If the browser's main storage (IndexedDB) doesn't answer within 2 seconds, TipNet opens from its backup copy and takes in the newer copy later.
- TipNet isn't set up without a pay period start date; a missing one is never filled in with today.
- "All changes saved" only appears after a real save; a failed save shows a banner with "Try again".
- Backup files (tipnet-backup-YYYY-MM-DD.json) hold the same data as backup codes, without the license key or a half-finished setup. A reminder appears at 5+ real nights with no backup in 30 days; iPhone Safari users get a one-time note about Safari clearing data.
- billing-config.js loads from the offline cache and refreshes in the background, so the first screen never waits on the network; switching payments on reaches installed apps on their next open.
- `npm run test:dates` (also run before every publish) runs all tests under three fake dates, so date-dependent tests can't silently break later.
- Savings progress (owner decision): each paycheck, every goal and plan asks "How much did you put toward this from this check?"; the amount actually saved is recorded (one entry per check, editable), and plans re-adjust: date plans recompute the amount per paycheck, set-amount plans move the ready-by date. Old "set aside" ticks were dropped without changing saved amounts.
- Spending categories have a frequency: weekly (Mon–Sun), every two weeks (14-day blocks from the category's start date), or monthly (default; old categories stay monthly). Money set aside per day = amount ÷ days in that period, never more than what's left of today's period. The after-payday view also deducts spending from "What is left". Monthly equivalent: weekly × 52/12, every two weeks × 26/12.
- Goals and plans show what's possible first (owner decision): after the name, amount and amount already saved, TipNet shows what could be put aside each paycheck (typical check + regular other income − bills − spending − other goals, never below 0, with "How we worked this out"); a $5-step slider linked to an amount box sets the amount, and the number of paychecks and ready-by date update live. "Need it by a certain date?" is the secondary path.
- Multiple restaurants (owner request): each restaurant has its own pay schedule, payday, paystub and tax rate, jobs and pay, tip-out, entry mode, setup progress and accuracy history; nights belong to one restaurant. Old data becomes restaurant #1 ("My restaurant", renamable); old backup codes and files restore the same way.
- Tonight and Setup share the picked restaurant (remembered); Pay periods keeps its own All / per-restaurant filter. Switching on Tonight keeps each restaurant's unsaved draft. Overtime notes, duplicate-date checks and shift averages are per restaurant.
- "+ Set up another restaurant" is on the full Setup page (not during first-run setup). Names are required, unique, up to 40 characters; at most 12 restaurants. Removing one removes its nights (Undo restores everything); the last one can't be removed. A night with an unknown restaurant goes to the first, so nothing is dropped.
- Budget combines all restaurants: money on hand includes cash kept from every restaurant's current pay period; "Safe to spend" runs until the next money arriving from any restaurant or other income; the after-payday view lists every check in its window.
- Each savings goal is saved from one restaurant's paychecks (default: the one paying most often). What's safe to put aside per check counts every restaurant's typical income scaled to that restaurant's pay period, minus bills, spending and other goals over the same days, and is also capped at that restaurant's own check plus other income minus its other goals (so a small second job isn't charged every bill).
- The goal slider can't go above what's safe to put aside from each check (owner decision); the amount box is held to the same maximum. At $0 the slider is off with links to edit spending or other goals; before the first finished pay period there's no slider and a typed amount is saved as an estimate. What was actually saved each check is never capped.
- The publishing check lets a change to app/js/billing-config.js alone through without a VERSION bump (it refreshes in the background); the bump is still recommended.
- Cash not run through payroll (owner request): an honest payroll-withholding option, never "tax-free". Setup (per restaurant) has "Cash tips here usually aren't run through payroll" (profile.cashOffPayroll, false for all old data); Tonight shows "Cash tips weren't run through payroll tonight" only once cash is entered, pre-ticked from that default until touched (a saved night keeps its own choice). Withholding then applies to kept minus the cash kept (cash in hand after any barback cash tip-out, never more than the tips kept, so hourly wages stay taxed); take-home rises by the tax not taken and TipNet shows "Set aside about $X for taxes on tonight's cash (estimate)" (same effective rate). The federal tips note excludes that cash (nothing was withheld on it). Check my accuracy leaves that cash out of the taxed base so the rate isn't distorted; Budget subtracts the current period's estimate (per restaurant) from Safe to spend. Copy never advises not reporting.

- CSV import with both Tips and Total mapped: Total wins and the night stores no `tips` (so its total stays what the file said, instead of drifting to tips + current pay). With only Tips mapped, the night stores tips as before. The preview shows each night's stored total and the take-home computeNight gives for that stored night, plus a note when both columns are chosen.
- Two open copies (fix after review): another window's save is merged into the live state object (never replaced), so screens can't write into a stale copy; a save with nothing new writes and announces nothing; a redraw caused by another window keeps focus, Tonight entries and half-typed forms. If both windows edit the same Setup field at the same moment, the last one typed wins.
- Bills count from the day they were added ("since"); a bill added after its due day this month asks "Already paid this month?" (ticked by default). Bills saved before this change start on the day of the update. Example bills start today.
- Setup clears the accuracy adjustment only when gross pay or the total of percentage deductions changes (per restaurant), says so in one line, and restores it if the rates are put back. Fixed-deduction edits (like insurance) no longer clear it.
- Tonight shows a live "Estimated take-home" line right under the tips box on phones, in addition to the full breakdown below.
- Tapping Refresh for an update reloads other open windows only when nothing is typed there; otherwise they show "Update available. Refresh".
- CSV import: rows dated after tomorrow are skipped as unreadable dates (the same bound Tonight uses); the import screen no longer prints a stray "null" when there is one restaurant.

## Review 6 fixes
- "Room to put aside", the slider cap, the realism line ("% of what you typically take home a pay period") and the "How we worked this out" label all use one figure: typicalTakeHome() = typical check + cash you keep, less the taxes to set aside on cash that skipped payroll, per restaurant (average of finished pay periods, else this period scaled up). The paycheck alone made mostly-cash workers look like they had $0 to save. The after-payday view adds the cash tips each restaurant typically keeps over that window's days.
- When the budget leaves nothing, the slider and the amount box stay capped at $0 (owner rule kept), but a goal or plan can still be added at $0 a paycheck ("save when you can"); the form says why and the goal row says it has no set amount yet.
