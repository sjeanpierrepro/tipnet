# TipNet: Staff Guide

Short guide for bartenders. Works on a phone.

---

## 1. Open TipNet

Go to **https://tipmynet.com** (or tap the link your bar gives you). Bookmark it.

**Used TipNet before at the old link (sjeanpierrepro.github.io/tipnet)?** Your nights stay with the old app. Open the old app from your home screen (or open the old link the way you always did), go to Setup > Backups > **Save a backup file** (**Copy backup code** works too). Then open https://tipmynet.com, install it (step 2), and restore that file **before** you enter anything there (restoring replaces what is already saved). After that you can delete the old icon.

## 2. Add it to your home screen

The first time you set up, TipNet offers this as one more step: on iPhone it comes first (add the icon, then set up from the icon, since Safari and the icon keep separate data); on Android and on computers that offer an install button it comes last, after your setup is saved (tap **Not now** or **Done** to skip it). If TipNet is already installed, there is no extra step.

- **iPhone (Safari):** Share button > **Add to Home Screen** > **Add**.
- **Android (Chrome):** Menu (three dots) > **Install app** (or **Add to Home screen**).
- **Computer (Chrome or Edge):** click the install icon in the address bar.

Always open TipNet the same way. On iPhone, Safari and the home-screen app keep separate data.

## 3. Set up from one paystub (one time)

Grab your latest paystub. The first time, TipNet opens in **Setup**. (Moving from another phone? Tap **Restore a backup code** instead. A backup made by a newer TipNet is refused until this phone has the update too: reload TipNet, then restore again. Something that isn't a TipNet backup is refused too, and nothing here is changed.) Until setup is done, Tonight has no numbers; **See an example first** shows made-up ones.

**Step 1: Pay period and gross pay**
- **Pay period started** and **Pay period ended** (the dates on the stub)
- **Shifts you work in a pay period** (needed: one whole number, like 10 or "10 shifts". Your fixed deductions are split evenly over these shifts, so every night of a pay period carries the same share)
- **You get paid** (every week, every two weeks, twice a month on calendar halves, every 15 days, once a month on the same day, or every 30 days; twice a month and once a month follow the calendar and set the end date for you)
- **Payday for this pay period**: the pay date on your stub. It is needed, because TipNet and Budget use it to know when your money arrives. If your Setup row says **Add your payday**, open it and pick the date.
- **Gross pay** (top-line gross, before anything comes out)

**Step 2: Deductions**
- Add each line that comes out: federal tax, Social Security, Medicare, state tax, health insurance, and so on.
- Choose **Changes with my pay** for taxes and **Same every check** for things like insurance.
- **Non-taxable earnings on this paystub** (optional): money your stub lists as non-taxable, like an expense or mileage reimbursement, a uniform or tool allowance, or a meal allowance. Tap **+ Add non-taxable earnings**, pick the kind, type the amount, and say whether it **Comes every check** or was **Just this once**. TipNet leaves it out of your tax rate and adds the every-check ones to your check without tax.

**Step 3: Your jobs and pay**
- **Jobs:** add every job you do where you work and what it pays: for example **Bartender** $12 per hour, **Prep** $10 per hour, **Supervisor / shift lead** $15 per hour, **Training**, or a **Private event / banquet** paid per shift. The first job is your main job. Tap **+ Add a job** for each extra one. Not in the list? Pick **Other job** and type its name. Removing a job (or other pay) never takes away pay you already logged for it: those nights keep it, and adding the job back with the same name counts them again.
- **Other pay** (only if you get it): **Overtime** (filled in at 1.5 times your main job's rate), **Holiday pay**, a **shift lead / supervisor differential** (the extra per hour on top), **Paid time off / sick pay**, **Bonus**, **Commission**, or a **Service charge / auto-gratuity** (that one is wages, not tips). The **Non-taxable** kinds (like a mileage reimbursement for one night) are added to that night's take-home without tax.
- **Tip-outs:** tick **I tip out** if you share tips. Tap **+ Add someone you tip out** for each person or station (Barback, Runner, Busser, Bar, Host, Kitchen, or Other with its own name). For each one pick how much: a **% of my tips** (decimals are fine, like 1.25%) or a **flat $ a night**, and whether it comes **from my cash** or **through payroll**. Each night you enter your tips before tipping out, and TipNet takes the tip-outs out. Don't tip out? Leave **I tip out** unticked: the tips you enter are what you keep.

Tap **Finish setup**.

### Example paystub

```
Pay period:  Sep 1 - Sep 14      Federal tax:     $180
Shifts worked: 10                Social Security: $124
Hourly rate:   $12               Medicare:         $29
Gross pay:   $2,000              Health ins.:      $60
```

Enter: start Sep 1, end Sep 14, shifts 10, every two weeks, gross $2,000, the four deductions, and your job (Bartender) at $12 per hour.

Type amounts with numbers and one decimal point, like 12.50 (a $ sign and commas like 1,250 are fine). If a box has something TipNet can’t read, like 1.2.3, it tells you and won’t save it until you fix it.

Something changed (raise, new insurance)? Update it in **Setup**. Once you are set up, Setup shows each establishment as one line (for example "Bartender $12/h · every two weeks · payday Fri"). Tap it to open everything for that establishment, make your changes, then tap **Save** (or **Cancel** to throw them away). Nothing changes until you save; if you leave with changes not saved, TipNet asks **Save changes?** first. The shared settings below (Late nights, Appearance, Install TipNet, Backups) are one line each too; tap to open them. Those apply right away.

**Work at a second establishment?** In **Setup**, tap **+ Set up another establishment**, type its name, and do the same three steps with a paystub from there. Its pay schedule, jobs and tip-out are kept apart from the first one. You can have up to 3 establishments in the free app, or up to 5 with TipNet Budget. To rename or remove an establishment, open its line in Setup (removing one also removes its nights; **Undo** brings them back).

## 4. Every night

- **Two establishments?** First pick where you worked under **Working at:** at the top. Nothing is picked until you do, and after you save it is cleared for the next night. Each establishment keeps what you half-typed there while the app is open.
- **CC tips** and **Cash tips:** type your credit card tips and your cash tips, before tipping out. Fill in both: type 0 if you had none (a night with only hours is 0 and 0). TipNet adds the pay for the jobs you worked.
- **What did you work tonight?** Your main job is already picked (with only one job, TipNet just shows it). Type the **hours** (8, 7.5, 7:30 or 45 min); the rate fills in by itself. Worked a double? Tap **+ Add another job**, pick it and type its hours (for example Prep 2 hours, then Bartender 6 hours). Overtime, holiday hours or a bonus? Tap **+ Add other pay**.
- **Cash not run through payroll:** If your bar doesn't run cash tips through payroll, tick the box; set aside the amount TipNet shows for tax time.
- **Tipped out tonight:** everyone you tip out is ticked. Untick anyone you did not tip out tonight. Your result lists each tip-out, for example Barback (15% of tips) −$73.35.
- **Cash tips** are all the cash you collected: if you tip anyone out of your cash, TipNet takes their cash out.
- Hours are typed every night, because shifts are never quite the same length.
- Tap **Save night** (with two establishments it says where, like **Save night at Second Spot**, and so does the message: "Saved to Second Spot: ...").

You see your estimated take-home, the cash you keep, and what should land on your check. If the same date already has a night, TipNet asks whether to add to it, replace it, or save a separate night.

## 5. After a pay period ends (optional)

**Pay periods** > **Check my accuracy**. With two establishments, pick the establishment first. Pick a pay period that has already ended. Enter the **take-home amount on your check** (the amount actually deposited, not gross). Tap **Compare with my estimate**.

The estimate usually gets closer after a check or two. Changing gross pay or a deduction that changes with your pay in Setup clears this adjustment (Setup says so); fixed amounts and names do not.

---

## Nightly reminder (optional)

TipNet cannot send its own notifications (it has no server), so the reminder is an event in your phone's calendar. In **Setup**, open **Nightly reminder**, pick the time and tick the **nights you work**, then tap **Add to my calendar** and open the file your phone saves. Your calendar repeats the reminder every week. A late time like 2:00 AM is fine: times before noon remind you the morning after each night you work, so a 2:00 AM reminder for Saturday night comes early Sunday morning. A time from noon on (like 11:00 PM) comes that same night.

To change it later, add a new one the same way and delete the old reminder in your calendar.

## Good to know

- **Logging after midnight?** Before 6 a.m. it is saved as the night before.
- **Raise or new deduction?** It changes the running pay period only; finished ones keep the numbers they were saved with. To bring a finished pay period up to date, tap **Update this pay period to today's Setup** under it in **Pay periods**. TipNet shows the take-home before and after and asks first; **Undo** puts it back.
- **Editing an older night?** Nights saved before this version show their tips split into **CC tips** and **Cash tips**. If a night was saved without a cash amount, its tips all show as CC tips; when you type its cash, TipNet takes it out of CC tips for you, so the night's tips stay the same (unless you change CC tips yourself).
- **Paycheck counted a night in another pay period?** In **Pay periods**, tap **Edit** on that night and pick the pay period it counts toward under **Counts toward the pay period that started:** (the pay period before, its own, or the next). If that changes a pay period that has already ended (for example moving a night back into the pay period that just ended), TipNet asks first. Changing a night's date moves it to that date's pay period (TipNet asks first if a finished period is involved).
- **Your data stays on your phone.** Your bar cannot see it. Every 10 nights you log, Tonight offers **Save backup file** (tap **Not now** to be asked again 10 nights later). Keep the file somewhere safe, like your email. If your phone shows **Save to iCloud or Google Drive** next to it, that sends the backup to Files or Drive through your share menu.
- **"Update available: Refresh"** means a new version is ready. Close any other TipNet windows or tabs, then tap **Refresh**. If your browser asks "Leave site?", choose **Leave**. Your nights are kept.
- **It is an estimate,** not an exact paycheck.
- **Tax questions?** Ask payroll or a tax professional. TipNet is not tax advice.

At the bottom of **Pay periods**, **So far this pay period** adds up the nights you have logged in the pay period in progress (estimated take-home, cash you keep, what is on your check). With TipNet Budget, the **Budget goal** card shows what your budget needs a month (your bills plus the savings planned for your goals), what that comes to for your pay period, and whether you are short or ahead so far. If you work at places paid on different schedules, it shows this month instead (filter on one place to see its pay period). Type an amount under **Extra goal** and pick **a month** or **a week** to add more on top; it only changes this card, never your Budget. **Remove extra goal** clears it.

## 6. Budget (optional, paid)
The Budget tab shows how much you can spend before your next payday, after bills and savings. With two establishments it counts both paychecks and shows whose check comes next; each goal asks **Save from which paycheck?** Add your bills (name, amount, day of the month), spending categories (like groceries) and goals. A new bill counts from the day you add it; if its due day already passed this month, TipNet asks **Already paid this month?** (ticked unless you untick it). Tick "Paid" when a bill is paid, and use "Log spending" when you buy something. Everything is an estimate. Budget is not part of the free app.

**Where to find it:** at the very bottom of **Tonight**, **Pay periods** and **Setup** there is a **TipNet Budget** card ($1.99 a month or $20 a year). Tap **See what's inside** for a preview, or **Upgrade** to go straight to the plans (there's an **Upgrade** button in the preview too). Already have a key? Paste it on the same screen, under **I have a license key**. Until payments are switched on, the card says **Coming soon**. Once Budget is unlocked on your phone, the card goes away.
