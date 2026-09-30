// Budget tab (paid add-on): safe to spend, next paycheck, bills, spending, goals, subscription.
// Locked users see an honest preview and can buy or paste a license key. The free app is unchanged.
import { todayISO, periodIndex, periodRange, toCents, round2, indexNights } from '../math.js';
import { isSetUp } from '../storage.js';
import {
  safeToSpend,
  lastPayday,
  hasPayDelay,
  billsDue,
  categoryStatus,
  goalProgress,
  exampleBudget,
  migrateBudget,
  paidKey,
  isPaid,
  goalKey,
  isGoalDone,
  paydayInfo,
  convertPaidKeys,
  hasOldPaidKeys,
  balanceIsStale,
  isPlan,
  purchasePlan,
  planShare,
  expectedIncome,
  incomeDates,
  otherIncomeMonthly,
  otherIncomePerPaycheck,
  INCOME_FREQ_LABEL,
} from '../budget.js';
import {
  BILLING,
  isUnlocked,
  activateKey,
  revalidate,
  deactivate,
  displayEntitlement,
  checkoutUrl,
  devEntitlement,
  isDevHost,
  getProvider,
} from '../billing.js';
import {
  el,
  clear,
  field,
  exampleBanner,
  setupFirstCard,
  moneyInput,
  select,
  numOf,
  clean,
  money,
  money0,
  fmtDate,
  fmtShort,
  toast,
  arm,
  save,
  bus,
  getState,
  debounce,
  addDays,
} from './common.js';

const MANAGE_URL = 'https://app.lemonsqueezy.com/my-orders';

/* ---------- screen-local state (cleared by reset) ---------- */
const addOpen = {}; // which "Add ..." boxes are open, so adding an item keeps its box (and keyboard focus) in place
let editing = null; // {kind, id} of the row being edited
let keyMsg = ''; // license key error
let keyText = ''; // what was pasted, kept so a failed try does not wipe it (never saved)
let busy = false;
let billsOpen = false; // keeps the "Edit or remove bills" list open after a save or cancel

export function reset() {
  editing = null;
  keyMsg = '';
  keyText = '';
  busy = false;
  billsOpen = false;
  addOpen.bill = addOpen.category = addOpen.goal = addOpen.plan = addOpen.income = false;
  doneOpen = false;
  planMode = 'date';
}

const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const ent = () => getState().settings.entitlement || null;
const unlocked = () => isUnlocked(ent());
const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/* ---------- billing boot: dev unlock, silent recheck ---------- */
let checking = false;
async function recheck() {
  if (checking) return; // boot and the "online" event can fire together: one request is enough
  checking = true;
  const S = getState();
  const before = unlocked();
  const asked = S.settings.entitlement;
  try {
    const next = await revalidate(asked, { online: isOnline() });
    // Only store the answer if the key was not removed or replaced while we waited.
    if (next && getState().settings.entitlement === asked) {
      getState().settings.entitlement = next;
      save();
    }
  } catch (e) {
    /* a failed recheck never locks anyone; the 14 day grace covers it */
  }
  checking = false;
  if (unlocked() !== before) bus.rerender();
}
/** Called once from app.js after load. Never throws, never blocks the first paint. */
export function bootBilling() {
  try {
    const S = getState();
    const before = unlocked();
    // A dev unlock only ever counts on localhost; drop one that arrived anywhere else.
    if (S.settings.entitlement && S.settings.entitlement.plan === 'dev' && !isDevHost(location)) {
      delete S.settings.entitlement;
      save();
    }
    const dev = devEntitlement(location);
    if (dev && !(S.settings.entitlement && S.settings.entitlement.plan === 'dev')) {
      S.settings.entitlement = dev;
      save();
    }
    if (unlocked() !== before) bus.rerender(); // the Budget tab may already be on screen
    recheck();
    window.addEventListener('online', recheck);
  } catch (e) {
    /* ignore */
  }
}

/* ---------- small pieces ---------- */
const bar = (pct, label) =>
  el(
    'div',
    {
      class: 'bar',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.min(100, pct)),
      'aria-label': label,
    },
    el('span', { style: 'width:' + Math.min(100, Math.max(0, pct)) + '%' }),
  );
const row = (a, b, cls) => el('div', { class: cls || null }, el('dt', null, a), el('dd', null, b));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- LOCKED: preview + upgrade ---------- */
function sampleCard(S) {
  const r = safeToSpend(exampleBudget(), S.profile, S.nights, todayISO(), { cashOnHand: 2400 });
  return el(
    'section',
    { class: 'card stack' },
    el(
      'div',
      { class: 'spread' },
      el('span', { class: 'label' }, 'Safe to spend until payday'),
      el('span', { class: 'pill' }, 'Example'),
    ),
    el(
      'div',
      { class: 'sample stack', 'aria-hidden': 'true' },
      el('div', { class: 'hero' }, money0(r.safe)),
      el('div', { class: 'hint' }, 'about ' + money0(r.perDay) + ' a day'),
      el(
        'dl',
        { class: 'breakdown' },
        row('Money you have now', money0(r.income.amount)),
        row('Bills due before payday', '−' + money0(r.billsTotal)),
        row('Saved toward goals', '−' + money0(r.goalsTotal)),
        row('Set aside for spending', '−' + money0(r.categoriesTotal)),
      ),
    ),
    el(
      'p',
      { class: 'hint' },
      'Made-up numbers, shown blurred so you can see the layout. Yours would come from your own bills and pay.',
    ),
  );
}

function upgradeCard() {
  const provider = getProvider();
  const ready = !!provider && !!checkoutUrl('monthly') && !!checkoutUrl('yearly');
  const buy = (plan, text) =>
    ready
      ? el(
          'a',
          {
            class: plan === 'yearly' ? 'btn btn-block' : 'btn btn-secondary btn-block',
            href: checkoutUrl(plan),
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          text,
        )
      : el(
          'button',
          {
            type: 'button',
            class: plan === 'yearly' ? 'btn btn-block' : 'btn btn-secondary btn-block',
            disabled: true,
          },
          text,
        );
  const keyIn = el('input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Paste your license key',
    value: keyText,
  });
  keyIn.addEventListener('input', () => {
    keyText = keyIn.value;
  });
  const kf = field('I have a license key', keyIn, {
    hint: 'After you pay, the payment service emails you a key. Paste it here to unlock Budget on this device.',
  });
  kf.setError(keyMsg);
  const go = el(
    'button',
    { type: 'submit', class: 'btn btn-secondary', disabled: busy },
    busy ? 'Checking…' : 'Unlock with key',
  );
  const form = el('form', { class: 'stack-sm', novalidate: true }, kf, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    keyMsg = '';
    keyText = keyIn.value;
    go.disabled = true;
    go.textContent = 'Checking…';
    const r = await activateKey(keyIn.value, {});
    busy = false;
    if (!r.ok) {
      keyMsg = r.error;
      bus.rerender();
      return;
    }
    keyText = '';
    getState().settings.entitlement = r.entitlement;
    save();
    toast('Budget is unlocked on this device.');
    bus.rerender();
  });
  const p = BILLING.prices;
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Unlock Budget'),
    el(
      'p',
      { class: 'note' },
      p.monthly +
        ' a month or ' +
        p.yearly +
        ' a year. Cancel any time from your receipt email. Tips and pay estimates stay free, always.',
    ),
    el(
      'div',
      { class: 'stack-sm' },
      buy('monthly', p.monthly + ' a month'),
      buy('yearly', p.yearly + ' a year'),
    ),
    ready
      ? el(
          'p',
          { class: 'hint' },
          'Opens the payment page in a new tab. Payments are handled by Lemon Squeezy, not by TipNet.',
        )
      : el('p', { class: 'hint' }, 'Payments aren’t switched on yet.'),
    form,
  );
}

function lockedView(S) {
  const stale = ent() && !unlocked();
  return el(
    'div',
    { class: 'stack' },
    el(
      'section',
      { class: 'card stack' },
      el('h1', null, 'Budget'),
      el(
        'p',
        null,
        'Budget answers one question: how much can I spend before my next payday? It takes the cash you have, subtracts the bills that are due, the money you are putting toward savings goals, and what you have set aside for groceries, gas and fun, and tells you what is left.',
      ),
      el(
        'p',
        null,
        'It also shows what your next paycheck will likely cover. All numbers are estimates from what you enter. It is a planning aid, not financial advice.',
      ),
    ),
    stale
      ? el(
          'div',
          { class: 'banner banner-warn' },
          el(
            'p',
            null,
            'Your subscription is not active on this device' +
              (isOnline()
                ? '.'
                : ', or it could not be checked while offline. Connect to the internet and open TipNet again.'),
          ),
        )
      : null,
    sampleCard(S),
    upgradeCard(),
    ent() ? subscriptionCard() : null,
  );
}

/* ---------- forms for bills, categories, goals ---------- */
const KINDS = {
  bill: {
    list: 'bills',
    noun: 'bill',
    fields: [
      { k: 'name', label: 'Bill name', type: 'text', ph: 'Rent' },
      { k: 'amount', label: 'Amount', type: 'money', req: true },
      { k: 'dueDay', label: 'Due day of the month (1 to 31)', type: 'day' },
    ],
  },
  category: {
    list: 'categories',
    noun: 'category',
    fields: [
      { k: 'name', label: 'Category name', type: 'text', ph: 'Groceries' },
      { k: 'monthly', label: 'Monthly amount', type: 'money', req: true },
    ],
  },
  goal: {
    list: 'goals',
    noun: 'goal',
    fields: [
      { k: 'name', label: 'Goal name', type: 'text', ph: 'Emergency fund' },
      { k: 'target', label: 'Target amount', type: 'money', req: true },
      { k: 'saved', label: 'Saved so far', type: 'money' },
      { k: 'perPaycheck', label: 'Put aside each paycheck', type: 'money' },
    ],
  },
};

function entityForm(kind, item) {
  const B = getState().budget,
    K = KINDS[kind];
  const ins = {},
    fs = [];
  K.fields.forEach((f) => {
    const v = item ? item[f.k] : '';
    const fk = 'ef-' + kind + '-' + (item ? item.id : 'new') + '-' + f.k; // stable, so focus survives a rerender
    const input =
      f.type === 'text'
        ? el('input', {
            type: 'text',
            autocomplete: 'off',
            placeholder: f.ph || '',
            maxlength: '40',
            value: v || '',
            'data-focus-key': fk,
          })
        : f.type === 'day'
          ? el('input', {
              type: 'text',
              inputmode: 'numeric',
              autocomplete: 'off',
              placeholder: '1',
              value: item ? String(v) : '',
              'data-focus-key': fk,
            })
          : moneyInput({ placeholder: '0.00', value: item && v ? String(v) : '', 'data-focus-key': fk });
    ins[f.k] = input;
    fs.push([f, field(f.label, input)]);
  });
  const btn = el(
    'button',
    {
      type: 'submit',
      class: 'btn btn-small',
      'data-focus-key': item ? 'ef-' + kind + '-' + item.id + '-name' : 'add-' + kind,
    },
    item ? 'Save changes' : 'Add ' + K.noun,
  );
  const cancel = item
    ? el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          'data-focus-key': 'ef-' + kind + '-' + item.id + '-name',
          onclick: () => {
            editing = null;
            bus.rerender();
          },
        },
        'Cancel',
      )
    : null;
  const form = el(
    'form',
    { class: 'stack-sm', novalidate: true },
    fs.map((x) => x[1]),
    el('div', { class: 'cluster' }, btn, cancel),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let bad = false;
    const out = {};
    fs.forEach(([f, fld]) => {
      const raw = ins[f.k].value;
      let msg = '';
      if (f.type === 'text') {
        out[f.k] = raw.trim();
        if (!out[f.k]) msg = 'Give it a name.';
      } else if (f.type === 'day') {
        const d = Math.round(numOf(raw));
        out[f.k] = d;
        if (!(d >= 1 && d <= 31)) msg = 'Enter a day from 1 to 31.';
      } else {
        const n = numOf(raw);
        out[f.k] = Math.max(0, n);
        if (f.req && !(n > 0)) msg = 'Enter an amount above zero.';
      }
      fld.setError(msg);
      if (msg) bad = true;
    });
    if (bad) {
      const first = form.querySelector('[aria-invalid]');
      if (first) first.focus();
      return;
    }
    if (item) Object.assign(item, out);
    else B[K.list].push({ id: newId(kind[0]), ...out });
    editing = null;
    save();
    bus.rerender();
    toast(item ? 'Saved.' : 'Added.');
  });
  return form;
}

/** A collapsible "Add ..." form that stays closed until wanted. */
const addBox = (kind, label) =>
  el(
    'details',
    {
      class: 'card',
      open: !!addOpen[kind],
      ontoggle: (e) => {
        addOpen[kind] = e.target.open;
      },
    },
    el('summary', null, label),
    el('div', { style: 'padding-top:var(--s-2)' }, entityForm(kind, null)),
  );

/** One polite live region (kept outside the re-rendered screen) so the armed "Delete?" state is spoken. */
function announce(text) {
  let r = document.getElementById('budget-live');
  if (!r) {
    r = el('div', { id: 'budget-live', class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.append(r);
  }
  r.textContent = text;
}
function removeBtn(label, onConfirm) {
  const b = el('button', { type: 'button', class: 'btn btn-danger btn-small', 'aria-label': label });
  const armed = 'Confirm d' + label.slice(1); // "Delete bill Rent" -> "Confirm delete bill Rent"
  const sync = () => {
    const on = b.getAttribute('data-armed') === 'true';
    b.setAttribute('aria-label', on ? armed : label);
    if (on) announce(armed + '. Press again to delete.');
  };
  arm(b, { label: 'Delete', armedLabel: 'Delete?', onConfirm });
  if (typeof MutationObserver === 'function')
    new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['data-armed'] });
  else b.addEventListener('click', sync);
  return b;
}
const editBtn = (kind, id, label) =>
  el(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary btn-small',
      'aria-label': label,
      'data-focus-key': 'ef-' + kind + '-' + id + '-name',
      onclick: () => {
        editing = { kind, id };
        bus.rerender();
      },
    },
    'Edit',
  );
const isEditing = (kind, id) => editing && editing.kind === kind && editing.id === id;

/* ---------- (a) safe to spend ---------- */
/** "Tue 9:40 pm" (or "Sep 22, 9:40 pm" once it is more than a week old). */
function asOfText(iso) {
  const d = new Date(iso);
  const time = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, ' ')
    .toLowerCase();
  const old = Date.now() - d.getTime() > 6 * 864e5;
  return (
    (old ? fmtShort(todayISO(d)) + ',' : d.toLocaleDateString('en-US', { weekday: 'short' })) + ' ' + time
  );
}

/** r0: the safeToSpend result the screen already worked out. Typing a balance saves it and works out a fresh one (once, after a pause). */
function heroCard(S, r0) {
  const host = el('section', { class: 'result stack' });
  const saved = S.budget.balance;
  const cashIn = moneyInput({
    id: 'budget-balance',
    'data-focus-key': 'budget-balance',
    placeholder: 'Blank = cash tips so far',
    value: saved ? String(saved.amount) : '',
  });
  const draw = (r) => {
    const neg = r.safe < 0;
    const bal = S.budget.balance;
    clear(host).append(
      ...[
        el('div', { class: 'hero-label' }, 'Safe to spend until payday (' + fmtDate(r.payday) + ')'),
        el('div', { class: 'hero num', 'aria-live': 'polite' }, money(r.safe)),
        el(
          'div',
          { class: 'hint' },
          neg
            ? 'estimated, ' + plural(r.daysAway, 'day') + ' to payday'
            : 'about ' + money(r.perDay) + ' a day for ' + plural(r.daysAway, 'day') + ' (estimated)',
        ),
        bal
          ? el(
              'p',
              { class: 'hint' },
              'Your balance as of ' +
                asOfText(bal.asOf) +
                (r.income.spent > 0 ? ', minus ' + money(r.income.spent) + ' you logged since.' : '.'),
            )
          : null,
        bal && balanceIsStale(bal)
          ? el(
              'p',
              { class: 'note' },
              'Update your balance: it is a few days old, so this number may be off. Type what you have now in the box above.',
            )
          : null,
        hasPayDelay(S.profile)
          ? null
          : el(
              'p',
              { class: 'hint' },
              'Assumes you’re paid the day after the pay period ends. ',
              el(
                'button',
                {
                  type: 'button',
                  class: 'btn-link',
                  'data-focus-key': 'budget-payday-link',
                  onclick: () => bus.go('setup'),
                },
                'Add your payday in Setup.',
              ),
            ),
        r.income.source === 'cash'
          ? el(
              'p',
              { class: 'hint' },
              'This counts only your cash tips from this pay period. Enter what you have in the bank and in cash above for a truer number.',
            )
          : null,
        neg
          ? el(
              'p',
              { class: 'note' },
              'What you have now is less than what is coming out before payday. That is common between checks. Your next paycheck is not counted here, so this usually evens out on payday. If you want it to be positive sooner, you could pay a bill after payday, or lower a spending amount.',
            )
          : null,
        breakdown(S, r),
      ].filter(Boolean),
    );
  };
  const box = el(
    'div',
    { class: 'card stack-sm' },
    field('Money you have right now (bank + cash)', cashIn, {
      optional: true,
      hint: 'Saved on this device with the time you entered it, so it is still here next visit. Update it when you check your bank. If you leave it blank, TipNet uses your cash tips from this pay period, minus spending you logged.',
    }),
  );
  let dirty = false;
  const commit = () => {
    if (!dirty) return;
    dirty = false;
    const n = parseFloat(clean(cashIn.value));
    S.budget.balance = Number.isFinite(n) ? { amount: round2(n), asOf: new Date().toISOString() } : null;
    save();
    draw(safeToSpend(S.budget, S.profile, S.nights, todayISO()));
  };
  const later = debounce(commit, 400);
  cashIn.addEventListener('input', () => {
    dirty = true;
    later();
  });
  cashIn.addEventListener('change', () => later.flush());
  draw(r0);
  return el('div', { class: 'stack' }, box, host); // the input comes first so the number below always reflects it
}

function breakdown(S, r) {
  const perDayCats = r.daysAway > 0 ? r.categoriesTotal / r.daysAway : 0;
  const catName = new Map(S.budget.categories.map((c) => [c.id, c.name]));
  return el(
    'details',
    null,
    el('summary', { class: 'btn-link' }, 'How this is worked out'),
    el(
      'dl',
      { class: 'breakdown', style: 'padding-top:var(--s-2)' },
      ...(r.income.source === 'entered'
        ? [row('Money you entered', money(r.income.amount))]
        : [
            row(
              r.income.source === 'balance' ? 'Your saved balance' : 'Cash tips this pay period',
              money(r.income.cash),
            ),
            r.income.spent > 0
              ? row(
                  r.income.source === 'balance'
                    ? 'Spending you logged since'
                    : 'Spending you logged this pay period',
                  '−' + money(r.income.spent),
                )
              : null,
          ].filter(Boolean)),
      ...(r.otherIncome.length
        ? [
            row('Other income before payday', '+' + money(r.otherIncomeTotal)),
            ...r.otherIncome.map((o) =>
              row('   ' + o.name + ', ' + fmtDate(o.date), '+' + money(o.amount), 'hint'),
            ),
          ]
        : []),
      row('Bills due before payday (' + r.bills.length + ' unpaid)', '−' + money(r.billsTotal)),
      ...r.bills.map((b) => row('   ' + b.name + ', ' + fmtShort(b.date), '−' + money(b.amount), 'hint')),
      row('Savings goals this paycheck', '−' + money(r.goalsTotal)),
      ...r.goals
        .filter((g) => g.due > 0)
        .map((g) =>
          row(
            '   ' + g.name + (g.done ? ' (already set aside)' : ''),
            g.done ? money(g.due) : '−' + money(g.due),
            'hint',
          ),
        ),
      row('Set aside for spending', '−' + money(r.categoriesTotal)),
      ...r.categories
        .filter((c) => c.reserved > 0)
        .map((c) => row('   ' + (catName.get(c.id) || c.name), '−' + money(c.reserved), 'hint')),
      row('Safe to spend', money(r.safe), 'total'),
    ),
    el(
      'p',
      { class: 'hint', style: 'padding-top:var(--s-2)' },
      'Set aside for spending is about ' +
        money(perDayCats) +
        ' a day across your spending categories (each one is its monthly amount divided by the days in the month), for the ' +
        plural(r.daysAway, 'day') +
        ' until payday. Where a category has less than that left this month, TipNet sets aside only what is left. Money from your next check is not counted until you are paid. Payday is the day your check arrives: set it in Setup, or TipNet assumes the day after your pay period ends. All figures are estimates.',
    ),
  );
}

/* ---------- (b) next paycheck ---------- */
const CHECK_HINT = {
  current:
    'The projected check comes from the nights you have logged this pay period with cash entered, scaled to the shifts you expect to work.',
  finished:
    'The projected check comes from the pay period that just ended. If some of its nights have no cash entered, TipNet scales up from the nights that do.',
  average:
    'No night in the pay period this check pays for has cash entered yet, so the projected check is your average check from past pay periods.',
};
function nextCheckCard(S, r0) {
  const a = r0.after;
  const known = a.projectedCheck != null;
  return el(
    'section',
    { class: 'card stack-sm' },
    el(
      'div',
      { class: 'card-title' },
      'After payday (' + fmtShort(a.periodStart) + ' – ' + fmtShort(a.periodEnd) + ')',
    ),
    el(
      'dl',
      { class: 'breakdown' },
      row('Projected check (estimated)', known ? money(a.projectedCheck) : 'Not known yet'),
      ...(a.otherIncome.length
        ? [row('Other income in that window (' + a.otherIncome.length + ')', '+' + money(a.otherIncomeTotal))]
        : []),
      row('Bills due in that window (' + a.bills.length + ')', '−' + money(a.billsTotal)),
      row('Savings goals', '−' + money(a.goalsTotal)),
      row('What is left', known ? money(a.left) : '–', 'total'),
    ),
    el(
      'p',
      { class: 'hint' },
      'These dates are the days you will be spending this check, from payday to the next payday. They are not the pay period the check is for. ',
      known
        ? CHECK_HINT[a.checkFrom] || CHECK_HINT.current
        : 'Log a night with its cash in hand and TipNet can estimate your check. The check is what is left after the cash you already took home.',
    ),
  );
}

/* ---------- (c) bills ---------- */
function billsCard(S, r0) {
  const B = S.budget,
    p = S.profile,
    today = todayISO();
  const idx = periodIndex(p, today);
  // Same window safe to spend and the next paycheck card count, so no bill they include is missing here.
  const nextEnd = periodRange(p, idx + 1).end;
  const afterEnd = r0.after.periodEnd;
  const upcoming = billsDue(B, lastPayday(p, today), afterEnd > nextEnd ? afterEnd : nextEnd);
  const rows = upcoming.map((b) => {
    const key = paidKey(b.id, b.date); // the bill and its due date, so a new pay schedule never un-pays it
    const cb = el('input', {
      type: 'checkbox',
      'aria-label': b.name + ' paid',
      checked: !!B.paidBills[key],
      'data-focus-key': 'paid-' + key,
    });
    cb.addEventListener('change', () => {
      if (cb.checked) B.paidBills[key] = true;
      else delete B.paidBills[key];
      save();
      bus.rerender();
    });
    return el(
      'li',
      { class: 'list-row' },
      el(
        'div',
        { class: 'main' },
        b.name,
        el(
          'div',
          { class: 'hint' },
          'Due ' + fmtDate(b.date) + (b.date < today && !isPaid(B, b) ? ', past due' : ''),
        ),
      ),
      el('div', { class: 'amount' }, money0(b.amount)),
      el('label', { class: 'check', style: 'padding:6px 12px' }, cb, 'Paid'),
    );
  });
  const manage = B.bills.map((b) =>
    isEditing('bill', b.id)
      ? el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, entityForm('bill', b)))
      : el(
          'li',
          { class: 'list-row wrap' },
          el(
            'div',
            { class: 'main' },
            b.name,
            el('div', { class: 'hint' }, money(b.amount) + ', due on day ' + b.dueDay + ' each month'),
          ),
          el(
            'div',
            { class: 'row-actions' },
            editBtn('bill', b.id, 'Edit ' + b.name),
            removeBtn('Delete ' + b.name, () => {
              const gone = b,
                goneMarks = {};
              B.bills = B.bills.filter((x) => x.id !== b.id);
              Object.keys(B.paidBills).forEach((k) => {
                if (k.startsWith(b.id + '@')) {
                  goneMarks[k] = B.paidBills[k];
                  delete B.paidBills[k];
                }
              });
              save();
              bus.rerender();
              toast('Bill removed.', {
                undo: () => {
                  if (!B.bills.some((x) => x.id === gone.id)) B.bills.push(gone);
                  Object.assign(B.paidBills, goneMarks);
                  save();
                  bus.rerender();
                },
              });
            }),
          ),
        ),
  );
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Bills'),
    rows.length
      ? el('ul', { class: 'list' }, rows)
      : el(
          'p',
          { class: 'hint' },
          B.bills.length
            ? 'No bills due before your next paycheck is spent.'
            : 'No bills yet. Add the ones that repeat every month.',
        ),
    rows.length
      ? el(
          'p',
          { class: 'hint' },
          'Tick a bill when you have paid it. It stops counting against safe to spend.',
        )
      : null,
    manage.length
      ? el(
          'details',
          {
            open: billsOpen || !!(editing && editing.kind === 'bill'),
            ontoggle: (e) => {
              billsOpen = e.target.open;
            },
          },
          el('summary', { class: 'btn-link' }, 'Edit or remove bills'),
          el('ul', { class: 'list', style: 'margin-top:var(--s-2)' }, manage),
        )
      : null,
    addBox('bill', 'Add a bill'),
  );
}

/* ---------- (d) spending ---------- */
function spendingCard(S) {
  const B = S.budget,
    today = todayISO();
  const cats = categoryStatus(B, today.slice(0, 7)).map((c) => {
    if (isEditing('category', c.id))
      return el(
        'li',
        { class: 'list-row wrap' },
        el(
          'div',
          { class: 'main' },
          entityForm(
            'category',
            B.categories.find((x) => x.id === c.id),
          ),
        ),
      );
    const over = c.remaining < 0;
    return el(
      'li',
      { class: 'list-row wrap' },
      el(
        'div',
        { class: 'main stack-sm' },
        el(
          'div',
          { class: 'spread' },
          el('span', null, c.name),
          el('b', { class: 'num' }, over ? money(-c.remaining) + ' over' : money(c.remaining) + ' left'),
        ),
        bar(c.pct, c.name + ' spending this month'),
        el('div', { class: 'hint' }, money(c.spent) + ' of ' + money(c.monthly) + ' this month'),
      ),
      el(
        'div',
        { class: 'row-actions' },
        editBtn('category', c.id, 'Edit ' + c.name),
        removeBtn('Delete ' + c.name, () => {
          const at = B.categories.findIndex((x) => x.id === c.id);
          if (at < 0) return;
          const [gone] = B.categories.splice(at, 1);
          save();
          bus.rerender();
          toast('Category removed.', {
            undo: () => {
              if (!B.categories.some((x) => x.id === gone.id))
                B.categories.splice(Math.min(at, B.categories.length), 0, gone);
              save();
              bus.rerender();
            },
          });
        }),
      ),
    );
  });

  let logBox;
  if (B.categories.length) {
    const amt = moneyInput({ placeholder: '0.00', 'data-focus-key': 'spend-amount' });
    const cat = select(
      B.categories.map((c) => [c.id, c.name]),
      B.categories[0].id,
      { 'data-focus-key': 'spend-category' },
    );
    const note = el('input', {
      type: 'text',
      autocomplete: 'off',
      maxlength: '60',
      placeholder: 'Coffee, groceries…',
    });
    const date = el('input', { type: 'date', value: today });
    const af = field('Amount', amt);
    const form = el(
      'form',
      { class: 'stack-sm', novalidate: true },
      af,
      field('Category', cat),
      field('Note', note, { optional: true }),
      field('Date', date),
      el('div', null, el('button', { type: 'submit', class: 'btn btn-small' }, 'Log spending')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = numOf(amt.value);
      if (!(n > 0)) {
        af.setError('Enter how much you spent.');
        amt.focus();
        return;
      }
      B.spends.push({
        id: newId('s'),
        date: date.value || today,
        amount: n,
        categoryId: cat.value,
        loggedAt: new Date().toISOString(),
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
      });
      save();
      bus.rerender();
      toast('Logged ' + money(n) + '.');
    });
    logBox = el('div', { class: 'card stack-sm' }, el('div', { class: 'card-title' }, 'Log spending'), form);
  } else logBox = el('p', { class: 'hint' }, 'Add a category first, then you can log what you spend.');

  const name = new Map(B.categories.map((c) => [c.id, c.name]));
  const recent = [...B.spends]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 10)
    .map((s) =>
      el(
        'li',
        { class: 'list-row' },
        el(
          'div',
          { class: 'main' },
          (name.get(s.categoryId) || 'Other') + (s.note ? ': ' + s.note : ''),
          el('div', { class: 'hint' }, fmtDate(s.date)),
        ),
        el('div', { class: 'amount' }, money(s.amount)),
        removeBtn('Delete spending ' + money(s.amount), () => {
          const i = B.spends.findIndex((x) => x.id === s.id);
          if (i < 0) return;
          const [gone] = B.spends.splice(i, 1);
          save();
          bus.rerender();
          toast('Spending deleted.', {
            undo: () => {
              B.spends.push(gone);
              save();
              bus.rerender();
            },
          });
        }),
      ),
    );

  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Spending'),
    cats.length
      ? el('ul', { class: 'list' }, cats)
      : el(
          'p',
          { class: 'hint' },
          'No categories yet. A category is money you plan to spend each month, like groceries or gas.',
        ),
    addBox('category', 'Add a spending category'),
    logBox,
    recent.length
      ? el(
          'div',
          { class: 'stack-sm' },
          el('div', { class: 'card-title' }, 'Recent spending'),
          el('ul', { class: 'list' }, recent),
        )
      : null,
  );
}

/* ---------- (e) goals and big-purchase plans ---------- */
let doneOpen = false; // keeps the "Done" list open after an Undo
let planMode = 'date'; // which way the "Plan a big purchase" form was last set

/** The "Add to saved" box, the "Set aside for this paycheck" tick and its hint. Shared by goals and plans. */
function goalControls(B, g, payday) {
  const add = moneyInput({
    placeholder: 'Amount',
    'aria-label': 'Amount to add to ' + g.name,
    'data-focus-key': 'goal-add-' + g.id,
    class: 'input',
  });
  const dkey = goalKey(g.id, payday);
  const done = el('input', {
    type: 'checkbox',
    'aria-label': 'Set aside for ' + g.name + ' this paycheck',
    checked: isGoalDone(B, g.id, payday),
    'data-focus-key': 'goal-done-' + g.id,
  });
  done.addEventListener('change', () => {
    if (done.checked) B.goalsDone[dkey] = true;
    else delete B.goalsDone[dkey];
    save();
    bus.rerender();
  });
  const addBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Add to saved');
  addBtn.addEventListener('click', () => {
    const n = numOf(add.value);
    if (!(n > 0)) {
      add.focus();
      toast('Enter an amount to add.');
      return;
    }
    g.saved = (toCents(g.saved) + toCents(n)) / 100;
    B.goalsDone[dkey] = true; // you just set money aside for this paycheck, so it stops coming out of the money you have now
    save();
    bus.rerender();
  });
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn.click();
    }
  });
  return [
    el('div', { class: 'cluster' }, el('div', { style: 'flex:1;min-width:120px' }, add), addBtn),
    el('label', { class: 'check' }, done, 'Set aside for this paycheck'),
    el(
      'div',
      { class: 'hint' },
      'Tick this once you have put the money away, or use Add to saved. It then stops coming out of the money you have now until your next payday.',
    ),
  ];
}

/** Delete with two taps and an Undo that puts the goal back where it was. */
function goalRemoveBtn(B, g, noun) {
  return removeBtn('Delete ' + (noun ? noun + ' ' : '') + g.name, () => {
    const at = B.goals.findIndex((x) => x.id === g.id);
    if (at < 0) return;
    const [gone] = B.goals.splice(at, 1);
    save();
    bus.rerender();
    toast(noun ? 'Plan removed.' : 'Goal removed.', {
      undo: () => {
        if (!B.goals.some((x) => x.id === gone.id)) B.goals.splice(Math.min(at, B.goals.length), 0, gone);
        save();
        bus.rerender();
      },
    });
  });
}

/** What the typical paycheck is, for comparing a plan to it: average take-home from finished periods, else this period's projected check. */
function typicalCheck(S) {
  const inc = expectedIncome(S.profile, S.nights, todayISO());
  const check = inc.avgTakeHomePerPeriod != null ? inc.avgTakeHomePerPeriod : inc.projectedCheck;
  if (check == null) return { base: null, other: 0 };
  const other = otherIncomePerPaycheck(S.budget, S.profile, todayISO()); // regular other income, spread over one pay period
  return { base: check + other, other };
}

/** The plain-words lines that describe a plan: what to put aside, and how big that is next to a typical check. */
function planLines(p, tc) {
  const lines = [];
  if (p.ready) lines.push('You already have enough saved for this.');
  else if (p.noPaychecks)
    lines.push(
      'No paychecks arrive before that date, so there is nothing to spread this over. Pick a later date.',
    );
  else if (p.paychecksLeft == null) lines.push('Enter an amount per paycheck to see a timeline.');
  else
    lines.push(
      'About ' +
        money(p.perPaycheck) +
        ' a paycheck for ' +
        plural(p.paychecksLeft, 'paycheck') +
        (p.readyBy ? ' (ready by ' + fmtDate(p.readyBy) + ')' : '') +
        '.',
    );
  if (!p.ready && !p.noPaychecks && p.paychecksLeft != null) {
    const sh = planShare(p.perPaycheck, tc.base);
    if (!sh) lines.push("We'll compare it to your paychecks once you have a finished pay period.");
    else {
      lines.push(
        "That's about " +
          sh.pct +
          '% of a typical check' +
          (tc.other > 0 ? ' plus your regular other income.' : '.'),
      );
      if (sh.big) lines.push("That's a big share of each check; a later date lowers it.");
    }
  }
  return lines;
}

/** The "Plan a big purchase" form. With an item it edits that plan. */
function planForm(item) {
  const S = getState(),
    B = S.budget;
  const today = todayISO();
  const key = (k) => 'ef-plan-' + (item ? item.id : 'new') + '-' + k;
  const name = el('input', {
    type: 'text',
    autocomplete: 'off',
    placeholder: 'Car down payment',
    maxlength: '40',
    value: item ? item.name : '',
    'data-focus-key': key('name'),
  });
  const cost = moneyInput({
    placeholder: '0.00',
    value: item && item.target ? String(item.target) : '',
    'data-focus-key': key('cost'),
  });
  const saved = moneyInput({
    placeholder: '0.00',
    value: item && item.saved ? String(item.saved) : '',
    'data-focus-key': key('saved'),
  });
  const mode0 = item ? (item.targetDate ? 'date' : 'fixed') : planMode;
  const pid = 'plan-' + (item ? item.id : 'new') + '-mode';
  const radio = (v, label) =>
    el(
      'label',
      { class: 'check' },
      el('input', {
        type: 'radio',
        name: pid,
        value: v,
        checked: mode0 === v,
        'data-focus-key': key('mode-' + v),
      }),
      label,
    );
  const byDate = el('input', {
    type: 'date',
    min: addDays(today, 1),
    value: item && item.targetDate ? item.targetDate : '',
    'data-focus-key': key('date'),
  });
  const perCheck = moneyInput({
    placeholder: '0.00',
    value: item && !item.targetDate && item.perPaycheck ? String(item.perPaycheck) : '',
    'data-focus-key': key('per'),
  });
  const fName = field('What is it?', name),
    fCost = field('How much does it cost?', cost),
    fSaved = field('Already saved', saved, { optional: true }),
    fDate = field('Date you want it by', byDate),
    fPer = field('How much can you put aside each paycheck?', perCheck);
  const preview = el('div', { class: 'stack-sm', id: pid + '-preview' });
  const mode = () => {
    const on = Array.from(form.querySelectorAll('input[type=radio]')).find((r) => r.checked);
    return on ? on.value : 'date';
  };
  // A draft goal from what is typed so far (null fields stay empty); the same maths as a saved plan.
  const draft = () => {
    const d = {
      kind: 'purchase',
      name: name.value.trim(),
      target: Math.max(0, numOf(cost.value)),
      saved: Math.max(0, numOf(saved.value)),
      createdAt: today,
    };
    d.startSaved = d.saved;
    if (mode() === 'date') d.targetDate = byDate.value;
    else d.perPaycheck = Math.max(0, numOf(perCheck.value));
    return d;
  };
  const refresh = () => {
    const m = mode();
    fDate.hidden = m !== 'date';
    fPer.hidden = m !== 'fixed';
    clear(preview);
    const d = draft();
    if (!(d.target > 0) || (m === 'date' ? !d.targetDate : !(d.perPaycheck > 0))) return;
    if (m === 'date' && d.targetDate <= today) return;
    preview.append(
      ...planLines(purchasePlan(d, S.profile, today), typicalCheck(S)).map((t, i) =>
        el('p', i === 0 ? { class: 'num' } : { class: 'hint' }, t),
      ),
    );
  };
  const submit = el(
    'button',
    { type: 'submit', class: 'btn btn-small', 'data-focus-key': item ? key('submit') : 'add-plan' },
    item ? 'Save plan' : 'Make this plan',
  );
  const cancel = item
    ? el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          onclick: () => {
            editing = null;
            bus.rerender();
          },
        },
        'Cancel',
      )
    : null;
  const form = el(
    'form',
    {
      class: 'stack-sm',
      novalidate: true,
      'aria-label': item ? 'Edit plan ' + item.name : 'Plan a big purchase',
    },
    fName,
    fCost,
    fSaved,
    el(
      'fieldset',
      { class: 'stack-sm' },
      el('legend', null, 'How do you want to plan it?'),
      radio('date', 'I want it by a date'),
      radio('fixed', 'I can put aside a set amount each paycheck'),
    ),
    fDate,
    fPer,
    preview,
    el('div', { class: 'cluster' }, submit, cancel),
  );
  form.addEventListener('input', refresh);
  form.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'radio' && !item) planMode = e.target.value;
    refresh();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = draft();
    const m = mode();
    let bad = false;
    const check = (f, msg) => {
      f.setError(msg);
      if (msg) bad = true;
    };
    check(fName, d.name ? '' : 'Give it a name.');
    check(fCost, d.target > 0 ? '' : 'Enter an amount above zero.');
    check(fSaved, '');
    check(fDate, m === 'date' && !(d.targetDate > today) ? 'Pick a date after today.' : '');
    check(fPer, m === 'fixed' && !(d.perPaycheck > 0) ? 'Enter an amount above zero.' : '');
    if (bad) {
      const first = form.querySelector('[aria-invalid]');
      if (first) first.focus();
      return;
    }
    const p = purchasePlan(d, S.profile, today);
    const fields = {
      kind: 'purchase',
      name: d.name,
      target: d.target,
      saved: d.saved,
      startSaved: d.saved,
      createdAt: today,
      perPaycheck: m === 'date' ? p.perPaycheck : d.perPaycheck,
    };
    if (m === 'date') fields.targetDate = d.targetDate;
    if (item) {
      delete item.targetDate;
      Object.assign(item, fields);
    } else B.goals.push({ id: newId('g'), ...fields });
    editing = null;
    save();
    bus.rerender();
    toast(item ? 'Saved.' : 'Plan added.');
  });
  refresh();
  return form;
}

function planRow(S, g, payday, tc) {
  const B = S.budget;
  if (isEditing('plan', g.id))
    return el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, planForm(g)));
  const p = purchasePlan(g, S.profile, todayISO());
  const status = p.ready
    ? el('b', null, 'Ready to buy')
    : el('b', null, p.onTrack ? 'On track' : 'Behind by ' + money(p.behind));
  const head = [
    el('div', { class: 'spread' }, el('span', null, g.name), el('b', { class: 'num' }, p.pct + '%')),
    bar(p.pct, g.name + ' progress'),
    el('div', { class: 'hint' }, money(g.saved) + ' saved of ' + money(g.target) + '.'),
  ];
  const body = [el('div', null, status)];
  if (p.ready) {
    const buy = el('button', {
      type: 'button',
      class: 'btn btn-small',
      'aria-label': 'Mark ' + g.name + ' as bought',
      'data-focus-key': 'plan-bought-' + g.id,
    });
    arm(buy, {
      label: 'Mark as bought',
      armedLabel: 'Bought? Tap again',
      onConfirm: () => {
        g.boughtAt = todayISO();
        doneOpen = false;
        save();
        bus.rerender();
        toast('Moved to Done.', {
          undo: () => {
            delete g.boughtAt;
            save();
            bus.rerender();
          },
        });
      },
    });
    body.push(el('div', { class: 'hint' }, 'You have saved enough. Nice work.'), buy);
  } else {
    planLines(p, tc).forEach((t, i) => body.push(el('p', i === 0 ? { class: 'num' } : { class: 'hint' }, t)));
    body.push(
      el(
        'div',
        { class: 'hint' },
        (p.paychecksLeft != null ? plural(p.paychecksLeft, 'paycheck') + ' left. ' : '') +
          (g.targetDate ? 'Wanted by ' + fmtDate(g.targetDate) + '. ' : '') +
          'The amount is worked out again each payday (estimated).',
      ),
    );
    body.push(...goalControls(B, g, payday));
  }
  return el(
    'li',
    { class: 'list-row wrap' },
    el('div', { class: 'main stack-sm' }, ...head, ...body),
    el(
      'div',
      { class: 'row-actions' },
      editBtn('plan', g.id, 'Edit plan ' + g.name),
      goalRemoveBtn(B, g, 'plan'),
    ),
  );
}

function doneList(S, done) {
  const B = S.budget;
  return el(
    'details',
    {
      class: 'stack-sm',
      open: doneOpen,
      ontoggle: (e) => {
        doneOpen = e.target.open;
      },
    },
    el('summary', null, 'Done (' + done.length + ')'),
    el(
      'ul',
      { class: 'list' },
      done.map((g) =>
        el(
          'li',
          { class: 'list-row wrap' },
          el(
            'div',
            { class: 'main' },
            el('span', null, g.name),
            el('div', { class: 'hint' }, money(g.target) + ', bought ' + fmtShort(g.boughtAt) + '.'),
          ),
          el('div', { class: 'row-actions' }, goalRemoveBtn(B, g, 'plan')),
        ),
      ),
    ),
  );
}

function goalsCard(S) {
  const B = S.budget;
  const payday = paydayInfo(S.profile, todayISO()).date; // a tick lasts until this payday
  B.goalsDone = B.goalsDone || {};
  const tc = typicalCheck(S);
  const rows = B.goals
    .filter((g) => !g.boughtAt)
    .map((g) => {
      if (isPlan(g)) return planRow(S, g, payday, tc);
      if (isEditing('goal', g.id))
        return el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, entityForm('goal', g)));
      const pr = goalProgress(g);
      const togo =
        pr.remaining === 0
          ? 'Goal reached.'
          : pr.paychecksToGo == null
            ? 'Set an amount per paycheck to see a timeline.'
            : 'About ' + plural(pr.paychecksToGo, 'paycheck') + ' to go (estimated).';
      return el(
        'li',
        { class: 'list-row wrap' },
        el(
          'div',
          { class: 'main stack-sm' },
          el('div', { class: 'spread' }, el('span', null, g.name), el('b', { class: 'num' }, pr.pct + '%')),
          bar(pr.pct, g.name + ' progress'),
          el(
            'div',
            { class: 'hint' },
            money(g.saved) +
              ' of ' +
              money(g.target) +
              ', ' +
              money(g.perPaycheck) +
              ' per paycheck. ' +
              togo,
          ),
          ...goalControls(B, g, payday),
        ),
        el('div', { class: 'row-actions' }, editBtn('goal', g.id, 'Edit ' + g.name), goalRemoveBtn(B, g, '')),
      );
    });
  const done = B.goals.filter((g) => g.boughtAt);
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Savings goals'),
    rows.length
      ? el('ul', { class: 'list' }, rows)
      : el(
          'p',
          { class: 'hint' },
          'No goals yet. A goal is something you are saving toward, like an emergency fund.',
        ),
    addBox('goal', 'Add a savings goal'),
    el(
      'details',
      {
        class: 'card',
        open: !!addOpen.plan,
        ontoggle: (e) => {
          addOpen.plan = e.target.open;
        },
      },
      el('summary', null, 'Plan a big purchase'),
      el('div', { style: 'padding-top:var(--s-2)' }, planForm(null)),
    ),
    done.length ? doneList(S, done) : null,
  );
}

/* ---------- (f) other income ---------- */
const FREQ_OPTIONS = [
  ['weekly', 'Every week'],
  ['biweekly', 'Every two weeks'],
  ['twiceMonthly', 'Twice a month'],
  ['monthly', 'Once a month'],
  ['once', 'One time'],
];

/** The "Add other income" form. With an item it edits that source. Money is entered once; every later date is worked out. */
function incomeForm(item) {
  const B = getState().budget;
  const key = (k) => 'ef-income-' + (item ? item.id : 'new') + '-' + k;
  const name = el('input', {
    type: 'text',
    autocomplete: 'off',
    placeholder: 'DoorDash',
    maxlength: '40',
    value: item ? item.name : '',
    'data-focus-key': key('name'),
  });
  const amount = moneyInput({
    placeholder: '0.00',
    value: item && item.amount ? String(item.amount) : '',
    'data-focus-key': key('amount'),
  });
  const freq = select(FREQ_OPTIONS, item ? item.freq : 'weekly', { 'data-focus-key': key('freq') });
  const next = el('input', { type: 'date', value: item ? item.nextDate : '', 'data-focus-key': key('date') });
  const dayAttrs = (k, v) => ({
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder: '1 to 31',
    value: v ? String(v) : '',
    'data-focus-key': key(k),
  });
  const day1 = el('input', dayAttrs('day1', item && item.days ? item.days[0] : ''));
  const day2 = el('input', dayAttrs('day2', item && item.days && item.days[1] ? item.days[1] : ''));
  const lab1 = el('span', null, 'Day of the month');
  const fName = field('What is it called?', name),
    fAmount = field('How much does it pay?', amount),
    fFreq = field('How often?', freq),
    fNext = field('Next date it arrives', next, {
      hint: 'TipNet works out every date after this one, so you only enter it once.',
    }),
    fDay1 = field(lab1, day1),
    fDay2 = field('Second day of the month', day2);
  const sync = () => {
    fDay1.hidden = !(freq.value === 'monthly' || freq.value === 'twiceMonthly');
    fDay2.hidden = freq.value !== 'twiceMonthly';
    lab1.textContent =
      freq.value === 'twiceMonthly' ? 'First day of the month' : 'Day of the month (optional)';
  };
  freq.addEventListener('change', sync);
  sync();
  const submitBtn = el(
    'button',
    { type: 'submit', class: 'btn btn-small', 'data-focus-key': item ? key('submit') : 'add-income' },
    item ? 'Save changes' : 'Add other income',
  );
  const cancel = item
    ? el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          onclick: () => {
            editing = null;
            bus.rerender();
          },
        },
        'Cancel',
      )
    : null;
  const form = el(
    'form',
    {
      class: 'stack-sm',
      novalidate: true,
      'aria-label': item ? 'Edit other income ' + item.name : 'Add other income',
    },
    fName,
    fAmount,
    fFreq,
    fNext,
    fDay1,
    fDay2,
    el('div', { class: 'cluster' }, submitBtn, cancel),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = freq.value;
    const dayOf = (v) => Math.round(numOf(v));
    const okDay = (d) => d >= 1 && d <= 31;
    let bad = false;
    const check = (fld, msg) => {
      fld.setError(msg);
      if (msg) bad = true;
    };
    const n = name.value.trim(),
      a = numOf(amount.value);
    check(fName, n ? '' : 'Give it a name.');
    check(fAmount, a > 0 ? '' : 'Enter an amount above zero.');
    check(fNext, /^\d{4}-\d{2}-\d{2}$/.test(next.value) ? '' : 'Pick the next date it arrives.');
    const needDay1 = f === 'twiceMonthly' || (f === 'monthly' && day1.value.trim());
    check(fDay1, needDay1 && !okDay(dayOf(day1.value)) ? 'Enter a day from 1 to 31.' : '');
    check(fDay2, f === 'twiceMonthly' && !okDay(dayOf(day2.value)) ? 'Enter a day from 1 to 31.' : '');
    if (bad) {
      const first = form.querySelector('[aria-invalid]');
      if (first) first.focus();
      return;
    }
    const out = { name: n, amount: Math.max(0, a), freq: f, nextDate: next.value };
    if (item) delete item.days;
    if (f === 'monthly') out.days = [day1.value.trim() ? dayOf(day1.value) : +next.value.slice(8, 10)];
    if (f === 'twiceMonthly') out.days = [dayOf(day1.value), dayOf(day2.value)].sort((x, y) => x - y);
    if (item) Object.assign(item, out);
    else (B.income ||= []).push({ id: newId('i'), ...out });
    editing = null;
    save();
    bus.rerender();
    toast(item ? 'Saved.' : 'Added.');
  });
  return form;
}

function otherIncomeCard(S) {
  const B = S.budget,
    today = todayISO();
  const list = B.income || [];
  const rows = list.map((src) => {
    if (isEditing('income', src.id))
      return el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, incomeForm(src)));
    const nextDate = incomeDates(src, today, addDays(today, 800))[0];
    return el(
      'li',
      { class: 'list-row wrap' },
      el(
        'div',
        { class: 'main' },
        el(
          'div',
          { class: 'spread' },
          el('span', null, src.name),
          el('b', { class: 'num' }, money(src.amount)),
        ),
        el(
          'div',
          { class: 'hint' },
          INCOME_FREQ_LABEL[src.freq].replace(/^./, (c) => c.toUpperCase()) +
            '. ' +
            (nextDate ? 'Next: ' + fmtDate(nextDate) + '.' : 'No more dates coming up.'),
        ),
      ),
      el(
        'div',
        { class: 'row-actions' },
        editBtn('income', src.id, 'Edit other income ' + src.name),
        removeBtn('Delete other income ' + src.name, () => {
          const at = B.income.findIndex((x) => x.id === src.id);
          if (at < 0) return;
          const [gone] = B.income.splice(at, 1);
          if (!B.income.length) delete B.income;
          save();
          bus.rerender();
          toast('Other income removed.', {
            undo: () => {
              B.income = B.income || [];
              if (!B.income.some((x) => x.id === gone.id))
                B.income.splice(Math.min(at, B.income.length), 0, gone);
              save();
              bus.rerender();
            },
          });
        }),
      ),
    );
  });
  const monthly = otherIncomeMonthly(B);
  return el(
    'section',
    { class: 'card stack' },
    el('h2', null, 'Other income'),
    el(
      'p',
      { class: 'hint' },
      'Money that does not go through TipNet, like a second job you do not track here, gig work, child support or benefits. Enter it once and TipNet works out every date.',
    ),
    rows.length ? el('ul', { class: 'list' }, rows) : el('p', { class: 'hint' }, 'Nothing added yet.'),
    monthly > 0
      ? el(
          'p',
          { class: 'hint' },
          'About ' +
            money(monthly) +
            ' a month from regular other income (estimated). One-time amounts are not counted.',
        )
      : null,
    el(
      'details',
      {
        class: 'card',
        open: !!addOpen.income,
        ontoggle: (e) => {
          addOpen.income = e.target.open;
        },
      },
      el('summary', null, 'Add other income'),
      el('div', { style: 'padding-top:var(--s-2)' }, incomeForm(null)),
    ),
  );
}

/* ---------- subscription ---------- */
export function subscriptionCard() {
  const S = getState(),
    e = ent();
  if (!e) return null;
  const d = displayEntitlement(e);
  const plan =
    d.plan === 'dev'
      ? 'Developer unlock (this computer only)'
      : d.plan === 'yearly'
        ? 'Yearly, ' + BILLING.prices.yearly + ' a year'
        : d.plan === 'monthly'
          ? 'Monthly, ' + BILLING.prices.monthly + ' a month'
          : 'Budget subscription';
  const status = unlocked() ? (d.status === 'on_trial' ? 'Trial' : 'Active') : 'Not active';
  const remove = el('button', { type: 'button', class: 'btn btn-danger btn-small' });
  arm(remove, {
    label: 'Remove from this device',
    armedLabel: 'Tap again to remove',
    onConfirm: async () => {
      remove.disabled = true;
      await deactivate(S.settings.entitlement);
      delete S.settings.entitlement;
      save();
      toast('Removed. Your budget is still saved here.');
      bus.rerender();
    },
  });
  return el(
    'section',
    { class: 'card stack-sm' },
    el('h2', null, 'Subscription'),
    el(
      'dl',
      { class: 'breakdown' },
      row('Plan', plan),
      row('Status', status),
      d.key ? row('License key', d.key) : null,
      d.expiresAt ? row('Current period ends', fmtDate(String(d.expiresAt).slice(0, 10))) : null,
    ),
    el(
      'p',
      { class: 'hint' },
      'To cancel or change your plan, open your orders with the payment service. Removing the key from this device frees it for another device and does not cancel billing.',
    ),
    el(
      'div',
      { class: 'cluster' },
      el(
        'a',
        {
          class: 'btn btn-secondary btn-small',
          href: MANAGE_URL,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'Manage subscription',
      ),
      remove,
    ),
  );
}

/** One quiet line for the Setup screen, only for people who have a subscription. */
export function subscriptionLine() {
  if (!ent()) return null;
  return el(
    'p',
    { class: 'hint' },
    'Budget subscription: ' +
      (unlocked() ? 'active' : 'not active') +
      '. Manage it at the bottom of the Budget tab. Backup codes do not include your license key.',
  );
}

/* ---------- unlocked view ---------- */
function unlockedView(S) {
  const B = S.budget;
  // Old paid ticks were keyed by pay period number. Re-key them by due date, once, using the current pay schedule.
  if (hasOldPaidKeys(B)) {
    B.paidBills = convertPaidKeys(B.paidBills, B.bills, S.profile);
    save();
  }
  // Worked out once per render and shared by the cards below (none of them needs it recomputed).
  const r0 = safeToSpend(B, S.profile, S.nights, todayISO(), { index: indexNights(S.profile, S.nights) });
  const empty = !B.bills.length && !B.categories.length && !B.goals.length && !B.spends.length;
  const start = el(
    'button',
    {
      type: 'button',
      class: 'btn',
      onclick: () => {
        S.budget = migrateBudget(exampleBudget());
        save();
        bus.rerender();
      },
    },
    'Start with example budget',
  );
  return el(
    'div',
    { class: 'stack' },
    el('h1', null, 'Budget'),
    exampleBanner(),
    empty
      ? el(
          'div',
          { class: 'banner' },
          el(
            'p',
            null,
            'Your budget is empty. Add your bills, spending categories and goals below, or start from an example and change it.',
          ),
          start,
        )
      : null,
    heroCard(S, r0),
    nextCheckCard(S, r0),
    billsCard(S, r0),
    spendingCard(S),
    otherIncomeCard(S),
    goalsCard(S),
    subscriptionCard(),
  );
}

export function render(root) {
  if (unlocked() && !isSetUp(getState())) {
    // Unlocked (or the dev switch) before setup: same rule as Tonight, no numbers from example taxes. The locked view is a
    // purchase page with a static sample, so it stays.
    root.append(
      el(
        'div',
        { class: 'stack' },
        el('h1', null, 'Budget'),
        setupFirstCard({
          text: 'Your budget works from your take-home, so TipNet needs your paystub first. It takes about 3 minutes.',
        }),
        // A real (non-dev) subscription stays manageable, so "Remove from this device" is never out of reach.
        ent() && ent().plan !== 'dev' ? subscriptionCard() : null,
      ),
    );
    return;
  }
  root.append(unlocked() ? unlockedView(getState()) : lockedView(getState()));
}
