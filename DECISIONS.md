
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
