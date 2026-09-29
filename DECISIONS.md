
## Shell, styling, PWA (scaffold worker)
- Fonts: WOFF2 latin subset from fonts.gstatic. Big Shoulders Display and Figtree are variable fonts (one file each, weight ranges 700-800 / 400-700); IBM Plex Mono only the 500 weight. Total ~70 KB.
- Light theme brass is darker (#8C6718 accent, #7A5810 hero) so it passes AA on light backgrounds; dark uses #C9A45C / #D6B46E.
- Theme: html[data-theme] set by an inline script in index.html from localStorage key "tipnet-theme" (avoids a flash). Setup UI should write that key too.
- Icons: T monogram in brass on #121417; PNGs generated with System.Drawing via app/icons/make-icons.ps1 (no node on this machine). Maskable uses 0.8 scale for the safe zone. Manifest uses relative start_url/scope for GitHub Pages subpaths.
- Service worker: cache-first, precaches each file individually (a missing file does not fail install). Accepts 'SKIP_WAITING' string or {type:'SKIP_WAITING'}. Bump VERSION each release.
- Deploy workflow runs `npm test` and needs a package.json with a test script (`node --test`) at repo root.
- Logic layer: money is rounded to whole cents per night (tax, tip-out, fixed share are each rounded), so period sums are exact cent sums; results can differ from unrounded prototype math by a cent.
- Logic layer: package.json test script is `node --test` (no `tests/` arg) because Node 22 treats a directory argument as a module path; it still discovers tests/*.test.js.
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
- gh CLI is not installed/authenticated here, so no GitHub repo was created and nothing was deployed; see DEPLOY.md.
- "You get paid" is always usable: choosing a schedule moves the end date to match (start + length - 1); if the dates disagree with the schedule, a note says the dates win. Replaces disabling the dropdown, which read as broken.

## Payments (budgeting add-on)
- Price: $1.99/month or $20/year. Provider: Lemon Squeezy (merchant of record, license keys). Code is provider-agnostic (interface in app/js/billing.js, chosen in app/js/billing-config.js). No server of our own.
- CORS check (2026-09-29, curl): OPTIONS preflight to api.lemonsqueezy.com/v1/licenses/activate returned 204 with access-control-allow-origin: *, allow-methods including POST, allow-headers Content-Type. A POST to /validate with an Origin header and a fake key returned 404 JSON {"valid":false,"error":"license_key not found."} with access-control-allow-origin: *. Browsers can call it directly, so no proxy is needed. proxy/lemonsqueezy-worker.js and the proxyUrl config field exist only as an unused fallback.
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
- Frequency 15 ("Twice a month") and 30 ("Once a month") follow the calendar instead of a fixed 15/30 days, which drifted from real pay periods. Weekly (7) and every-two-weeks (14) stay fixed lengths.
- Twice a month: anchors are day A = day of periodStart and B = A+15 (A <= 15) or A-15 (A > 15), so 1 -> 1/16, 5 -> 5/20, 16 -> 16/1. A period runs from one anchor to the day before the next; an anchor past the end of a short month is clamped to its last day. Once a month: the anchor is A each month, clamped the same way.
- Rule: when freq is 15 or 30 the calendar wins. periodEnd is ignored by the math (lengthFromDates is false) and Setup auto-sets the end date to the derived end of the first period (choosing the frequency, editing the start, or finishing an end-date edit). No "Your dates make the pay period N days long" note in this mode; a calendar note is shown instead. Existing profiles with a stale start+14 end date keep working: the stored end is simply not used.
- periodLength(p, idx) is now per period (idx defaults to 0); periodIndex/periodRange work for negative indexes. shiftsPerPeriod, periodTotals and calibrate take/derive the index so the 4-shifts-a-week default uses that period's length (e.g. 13-day Feb half = 7 shifts). Summary shows "twice a month (e.g. the 1st-15th and 16th-end)" instead of "N days". No storage schema change.
- sw.js VERSION bumped to tipnet-v11.
