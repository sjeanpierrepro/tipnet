// Budget tab (paid add-on): safe to spend, next paycheck, bills, spending, goals, subscription.
// Locked users see an honest preview and can buy or paste a license key. The free app is unchanged.
import { todayISO, periodIndex, periodRange, round2 } from '../math.js';
import { isSetUp, isWorkplaceSetUp, nightsOf } from '../storage.js';
import {
  safeToSpendAll,
  lastPayday,
  hasPayDelay,
  billsDue,
  categoryStatus,
  CAT_FREQS,
  CAT_FREQ_LABEL,
  CAT_PERIOD_WORDS,
  catFreq,
  spendingMonthly,
  possibleAside,
  asideRange,
  ASIDE_STEP,
  funderOf,
  exampleBudget,
  migrateBudget,
  paidKey,
  isPaid,
  contributionsOf,
  recordContribution,
  editContribution,
  removeContribution,
  restoreContribution,
  PLAN_BIG_SHARE,
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
let editingEntry = null; // {id, index}: the history entry of a goal that is being edited
const historyOpen = new Set(); // goal ids whose history list is open

export function reset() {
  editing = null;
  editingEntry = null;
  historyOpen.clear();
  keyMsg = '';
  keyText = '';
  busy = false;
  billsOpen = false;
  addOpen.bill = addOpen.category = addOpen.goal = addOpen.plan = addOpen.income = false;
  doneOpen = false;
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

/* ---------- the restaurants that pay you ---------- */
/**
 * One pay source per restaurant that is set up (a restaurant still being set up has no real paystub yet), for the
 * budget math: {id, name, profile, nights}. Bills and spending are paid from all of them; each goal from one (fundedBy).
 */
function sourcesOf(S) {
  const ready = S.workplaces.filter((w) => isWorkplaceSetUp(S, w));
  return (ready.length ? ready : S.workplaces.slice(0, 1)).map((w) => ({
    id: w.id,
    name: w.name,
    profile: w.profile,
    nights: nightsOf(S, w.id),
  }));
}
/** The restaurant a goal is saved from (its pick, else the one that pays most often). */
const funderFor = (g, src) => funderOf(g, src, todayISO());

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
  const r = safeToSpendAll(exampleBudget(), sourcesOf(S), todayISO(), { cashOnHand: 2400 });
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
      { k: 'monthly', label: 'Amount', type: 'money', req: true },
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
  // A spending category repeats every week, every two weeks or every month.
  const freqSel =
    kind === 'category'
      ? select(
          CAT_FREQS.map((v) => [v, CAT_FREQ_LABEL[v]]),
          item ? catFreq(item) : 'monthly',
          { 'data-focus-key': 'ef-category-' + (item ? item.id : 'new') + '-freq' },
        )
      : null;
  const freqField = freqSel ? field('How often', freqSel) : null;
  // A new bill whose due day already passed this month: was this month's one paid? (Yes unless they untick it.)
  const paidCb =
    kind === 'bill' && !item
      ? el('input', { type: 'checkbox', checked: true, 'data-focus-key': 'ef-bill-new-paid' })
      : null;
  const paidText = el('span', null, 'Already paid this month?');
  const paidField = paidCb ? el('label', { class: 'check', hidden: true }, paidCb, paidText) : null;
  const passedDue = () => {
    const d = Math.round(numOf(ins.dueDay ? ins.dueDay.value : ''));
    if (!(d >= 1 && d <= 31)) return null;
    const today = todayISO();
    const due = billsDue({ bills: [{ id: 'x', dueDay: d }] }, today.slice(0, 8) + '01', today)[0];
    return due && due.date < today ? due.date : null;
  };
  if (paidField) {
    const sync = () => {
      const due = passedDue();
      paidField.hidden = !due;
      if (due) paidText.textContent = 'Already paid this month? (it was due ' + fmtDate(due) + ')';
    };
    ins.dueDay.addEventListener('input', sync);
    sync();
  }
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
    freqField,
    paidField,
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
    if (kind === 'category') {
      const fq = freqSel.value;
      const was = item ? catFreq(item) : 'monthly';
      if (fq === 'monthly') {
        out.freq = undefined;
        out.anchor = undefined;
      } else {
        out.freq = fq;
        // Every-two-weeks periods count from the day the category started (or from when it was switched to this).
        out.anchor = item && was === fq && item.anchor ? item.anchor : todayISO();
      }
    }
    Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
    if (item) {
      if (kind === 'category' && !out.freq) {
        delete item.freq;
        delete item.anchor;
      }
      Object.assign(item, out);
    } else if (kind === 'bill') {
      // A bill counts from the day it is added; if this month's due date already passed, from that date, and it is
      // marked paid unless "Already paid this month?" was unticked (then it shows as owed).
      const due = passedDue();
      const bill = { id: newId('b'), ...out, since: due || todayISO() };
      B.bills.push(bill);
      if (due && paidCb.checked) B.paidBills[paidKey(bill.id, due)] = true;
    } else B[K.list].push({ id: newId(kind[0]), ...out });
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
function heroCard(S, r0, src) {
  const host = el('section', { class: 'result stack' });
  const many = src.length > 1;
  // Restaurants whose payday isn't set (TipNet then assumes the day after the pay period ends).
  const noDelay = src.filter((s) => !hasPayDelay(s.profile));
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
        el(
          'div',
          { class: 'hero-label' },
          many
            ? 'Safe to spend until ' + fmtDate(r.payday) + ' — ' + r.paydaySource.name + ' check'
            : 'Safe to spend until payday (' + fmtDate(r.payday) + ')',
        ),
        el('div', { class: 'hero num', 'aria-live': 'polite' }, money(r.safe)),
        el(
          'div',
          { class: 'hint' },
          neg
            ? 'estimated, ' + plural(r.daysAway, 'day') + ' to ' + (many ? 'the next check' : 'payday')
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
        !noDelay.length
          ? null
          : el(
              'p',
              { class: 'hint' },
              many
                ? 'Assumes ' +
                    noDelay.map((s) => s.name).join(' and ') +
                    ' pay' +
                    (noDelay.length === 1 ? 's' : '') +
                    ' the day after the pay period ends. '
                : 'Assumes you’re paid the day after the pay period ends. ',
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
              many
                ? 'This counts only your cash tips from this pay period at each restaurant. Enter what you have in the bank and in cash above for a truer number.'
                : 'This counts only your cash tips from this pay period. Enter what you have in the bank and in cash above for a truer number.',
            )
          : null,
        neg
          ? el(
              'p',
              { class: 'note' },
              'What you have now is less than what is coming out before payday. That is common between checks. Your next paycheck is not counted here, so this usually evens out on payday. If you want it to be positive sooner, you could pay a bill after payday, or lower a spending amount.',
            )
          : null,
        breakdown(S, r, many),
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
    draw(safeToSpendAll(S.budget, src, todayISO()));
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

/** The next check from each restaurant (not counted in Safe to spend until it arrives). */
function nextChecksRows(r) {
  return [
    row('Next checks (counted once they arrive)', ''),
    ...r.sources.map((s) =>
      row(
        '   ' + s.name + ', ' + fmtDate(s.payday),
        s.check == null ? 'Not known yet' : money(s.check),
        'hint',
      ),
    ),
  ];
}
function breakdown(S, r, many = false) {
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
      ...(r.taxAsideTotal > 0
        ? [
            row('Set aside for taxes on cash (estimate)', '−' + money(r.taxAsideTotal)),
            ...(many ? r.taxAside.map((t) => row('   ' + t.name, '−' + money(t.amount), 'hint')) : []),
          ]
        : []),
      row('Safe to spend', money(r.safe), 'total'),
      ...(many ? nextChecksRows(r) : []),
    ),
    el(
      'p',
      { class: 'hint', style: 'padding-top:var(--s-2)' },
      (r.taxAsideTotal > 0
        ? 'Set aside for taxes on cash is TipNet’s estimate of the tax on cash tips that weren’t run through payroll this pay period, so it isn’t spent before tax time. '
        : '') +
        'Set aside for spending is about ' +
        money(perDayCats) +
        ' a day across your spending categories (each one is its amount divided by the days in its week, two weeks or month), for the ' +
        plural(r.daysAway, 'day') +
        ' until payday. Where a category has less than that left in its current week, two weeks or month, TipNet sets aside only what is left. Money from your next check is not counted until you are paid. Payday is the day your check arrives: set it in Setup, or TipNet assumes the day after your pay period ends. All figures are estimates.',
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
function nextCheckCard(S, r0, src) {
  const a = r0.after;
  const known = a.projectedCheck != null;
  const many = src.length > 1;
  // Several restaurants: every check that arrives in the window, one row each, then their total.
  const checkRows = many
    ? [
        ...a.checks.map((k) =>
          row(
            k.name + ' check, ' + fmtDate(k.date) + ' (estimated)',
            k.amount == null ? 'Not known yet' : money(k.amount),
          ),
        ),
        a.checks.length > 1 ? row('Checks in that window', known ? money(a.projectedCheck) : '–') : null,
      ].filter(Boolean)
    : [row('Projected check (estimated)', known ? money(a.projectedCheck) : 'Not known yet')];
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
      ...checkRows,
      ...(a.otherIncome.length
        ? [row('Other income in that window (' + a.otherIncome.length + ')', '+' + money(a.otherIncomeTotal))]
        : []),
      row('Bills due in that window (' + a.bills.length + ')', '−' + money(a.billsTotal)),
      row('Savings goals', '−' + money(a.goalsTotal)),
      row('Set aside for spending', '−' + money(a.categoriesTotal)),
      row('What is left', known ? money(a.left) : '–', 'total'),
    ),
    el(
      'p',
      { class: 'hint' },
      many
        ? 'These dates run from the ' +
            r0.paydaySource.name +
            ' payday to the day before its next one. Checks from your other restaurants that arrive in between are counted too. '
        : 'These dates are the days you will be spending this check, from payday to the next payday. They are not the pay period the check is for. ',
      known
        ? many
          ? (a.unknownChecks
              ? 'A check marked “Not known yet” is left out until TipNet can estimate it. '
              : '') + 'Each check is worked out from that restaurant’s own nights.'
          : CHECK_HINT[a.checkFrom] || CHECK_HINT.current
        : 'Log a night with its cash in hand and TipNet can estimate your check. The check is what is left after the cash you already took home.',
    ),
  );
}

/* ---------- (c) bills ---------- */
function billsCard(S, r0, src) {
  const B = S.budget,
    today = todayISO();
  // Same window safe to spend and the next paycheck card count, so no bill they include is missing here: from the earliest
  // restaurant's last payday to the end of the after-payday window (or the end of each restaurant's next pay period).
  let from = null,
    to = r0.after.periodEnd;
  src.forEach((s) => {
    const lp = lastPayday(s.profile, today);
    const ne = periodRange(s.profile, periodIndex(s.profile, today) + 1).end;
    if (from == null || lp < from) from = lp;
    if (ne > to) to = ne;
  });
  const upcoming = billsDue(B, from, to);
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
  const cats = categoryStatus(B, today).map((c) => {
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
    const when = CAT_PERIOD_WORDS[c.freq || 'monthly'];
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
        bar(c.pct, c.name + ' spending ' + when),
        el(
          'div',
          { class: 'hint' },
          money(c.spent) + ' of ' + money(c.monthly) + ' ' + when,
          c.periodStart ? ' (' + fmtShort(c.periodStart) + ' – ' + fmtShort(c.periodEnd) + ')' : '',
        ),
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
    el('h2', { id: 'budget-spending-heading', tabindex: '-1' }, 'Spending'),
    cats.length
      ? el('ul', { class: 'list' }, cats)
      : el(
          'p',
          { class: 'hint' },
          'No categories yet. A category is money you plan to spend each week, every two weeks or each month, like groceries or gas.',
        ),
    B.categories.some((c) => catFreq(c) !== 'monthly')
      ? el(
          'p',
          { class: 'hint' },
          'All your spending categories come to about ' +
            money(spendingMonthly(B)) +
            ' a month (a week counts as 52 ÷ 12 weeks a month, two weeks as 26 ÷ 12).',
        )
      : null,
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

/** The local calendar day of an ISO date-time, "YYYY-MM-DD" ('' if unreadable). */
function localDay(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
/** "Oct 2 check: $150 (planned $218.19)" or "Extra: $50 (Oct 5)". */
function entryText(c) {
  if (c.payday)
    return (
      fmtShort(c.payday) +
      ' check: ' +
      money(c.amount) +
      (c.planned !== undefined ? ' (planned ' + money(c.planned) + ')' : '')
    );
  const day = localDay(c.recordedAt);
  return 'Extra: ' + money(c.amount) + (day ? ' (' + fmtShort(day) + ')' : '');
}

/** The status word for a goal: Ready to buy / Goal reached / Behind by / Ahead by / On track (null when there is nothing to measure against). */
function statusText(g, p) {
  if (p.ready) return isPlan(g) ? 'Ready to buy' : 'Goal reached';
  if (!p.hasSchedule) return isPlan(g) ? 'On track' : null;
  if (p.behind > 0) return 'Behind by ' + money(p.behind);
  if (p.ahead > 0) return 'Ahead by ' + money(p.ahead);
  return 'On track';
}

/**
 * The plain-words lines that say what to put aside and how that changed, for a goal or plan that is not done yet.
 * Returns {lines: [[text, isHint]], move: true when changing the date would help}.
 */
function trackerLines(g, p, tc) {
  const lines = [];
  let move = false;
  const share = () => {
    const sh = planShare(p.perPaycheck, tc.base);
    if (!sh) {
      lines.push(["We'll compare it to your paychecks once you have a finished pay period.", true]);
      return;
    }
    lines.push([
      "That's about " +
        sh.pct +
        '% of a typical check' +
        (tc.other > 0 ? ' plus your regular other income.' : '.'),
      true,
    ]);
    if (sh.pct > 50) {
      lines.push([
        'That is more than half of a typical check, which may be hard to keep up. A later date lowers it.',
        true,
      ]);
      move = true;
    } else if (sh.pct > PLAN_BIG_SHARE)
      lines.push(["That's a big share of each check; a later date lowers it.", true]);
  };
  if (p.mode === 'date') {
    if (p.noPaychecks) {
      lines.push([
        'No paychecks arrive before that date, so there is nothing to spread this over. Pick a later date.',
        false,
      ]);
      move = true;
    } else {
      lines.push([
        'To reach ' +
          money(p.cost) +
          ' by ' +
          fmtShort(g.targetDate) +
          ': ' +
          money(p.perPaycheck) +
          ' a paycheck for ' +
          plural(p.paychecksLeft, p.recorded != null ? 'more paycheck' : 'paycheck') +
          '.',
        false,
      ]);
      if (p.perChange)
        lines.push([
          (p.perChange > 0 ? 'Up ' : 'Down ') +
            money(Math.abs(p.perChange)) +
            ' because this check was ' +
            (p.perChange > 0 ? 'below' : 'above') +
            ' plan.',
          true,
        ]);
      share();
    }
  } else if (p.paychecksLeft == null) {
    lines.push([
      isPlan(g)
        ? 'Enter an amount per paycheck to see a timeline.'
        : 'Set an amount per paycheck to see a timeline.',
      false,
    ]);
  } else {
    const w = p.shiftDays == null ? 0 : Math.round(Math.abs(p.shiftDays) / 7);
    const moved =
      p.shiftDays != null && Math.abs(p.shiftDays) >= 4
        ? ' (moved ' + plural(Math.max(1, w), 'week') + (p.shiftDays > 0 ? ' later' : ' sooner') + ')'
        : '';
    lines.push(['Ready by about ' + (p.readyBy ? fmtShort(p.readyBy) : 'soon') + moved + '.', false]);
    lines.push([
      plural(p.paychecksLeft, 'paycheck') + ' to go at ' + money(p.perPaycheck) + ' a paycheck.',
      true,
    ]);
    if (isPlan(g)) share();
  }
  return { lines, move };
}

/** One row of the history list, with inline Edit and a two-tap Remove that has Undo. */
function historyRow(B, g, c, i) {
  const who = c.payday ? fmtShort(c.payday) + ' check' : 'extra';
  if (editingEntry && editingEntry.id === g.id && editingEntry.index === i) {
    const input = moneyInput({
      value: String(c.amount),
      'aria-label': 'New amount for ' + g.name + ', ' + who,
      'data-focus-key': 'entry-edit-' + g.id + '-' + i,
      class: 'input',
    });
    const fld = field('New amount for ' + entryText(c).split(':')[0], input);
    const okBtn = el(
      'button',
      {
        type: 'submit',
        class: 'btn btn-small',
        'aria-label': 'Save amount for ' + g.name + ', ' + who,
        'data-focus-key': 'entry-save-' + g.id + '-' + i,
      },
      'Save',
    );
    const cancel = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary btn-small',
        'data-focus-key': 'entry-edit-btn-' + g.id + '-' + i,
        onclick: () => {
          editingEntry = null;
          bus.rerender();
        },
      },
      'Cancel',
    );
    const form = el(
      'form',
      { class: 'stack-sm', novalidate: true },
      fld,
      el('div', { class: 'cluster' }, okBtn, cancel),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = clean(input.value);
      const n = numOf(raw);
      if (raw === '' || raw === '-' || raw === '.' || !(n >= 0)) {
        fld.setError(n < 0 ? 'Amounts cannot be negative.' : 'Enter an amount, or 0.');
        input.focus();
        return;
      }
      editContribution(g, i, n);
      editingEntry = null;
      save();
      bus.rerender();
      toast('Saved.');
    });
    return el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, form));
  }
  return el(
    'li',
    { class: 'list-row wrap' },
    el('div', { class: 'main' }, el('span', null, entryText(c))),
    el(
      'div',
      { class: 'row-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          'aria-label': 'Edit the amount for ' + g.name + ', ' + who,
          'data-focus-key': 'entry-edit-btn-' + g.id + '-' + i,
          onclick: () => {
            editingEntry = { id: g.id, index: i };
            historyOpen.add(g.id);
            bus.rerender();
          },
        },
        'Edit',
      ),
      removeBtn('Delete the amount for ' + g.name + ', ' + who, () => {
        const undo = removeContribution(g, i);
        if (!undo.ok) return;
        editingEntry = null;
        save();
        bus.rerender();
        toast('Removed.', {
          undo: () => {
            restoreContribution(g, undo);
            save();
            bus.rerender();
          },
        });
      }),
    ),
  );
}

/** What you put in so far: newest first, each with Edit and Remove. */
function historyBox(B, g) {
  const list = contributionsOf(g);
  if (!list.length) return null;
  return el(
    'details',
    {
      class: 'stack-sm',
      open: historyOpen.has(g.id),
      ontoggle: (e) => {
        if (e.target.open) historyOpen.add(g.id);
        else historyOpen.delete(g.id);
      },
    },
    el('summary', null, 'What you put in (' + list.length + ')'),
    el('ul', { class: 'list' }, list.map((c, i) => historyRow(B, g, c, i)).reverse()),
  );
}

/**
 * "How much did you put toward this from this check?" plus "Add to saved" for extra money and the history. Shared by goals and plans.
 * Recording an amount adds it to saved and stops this goal coming out of the money you have now until the next payday.
 */
/** funder: the restaurant whose checks this goal is saved from; its name is said when there is more than one. */
function goalControls(B, g, p, funder, many = false) {
  const who = (many && funder ? funder.name + ' ' : '') + fmtShort(p.payday);
  const plannedNow = p.recorded != null && p.perBefore != null ? p.perBefore : p.perPaycheck;
  const out = [];
  if (!p.ready) {
    const input = moneyInput({
      placeholder: plannedNow > 0 ? 'planned ' + money(plannedNow) : 'Amount',
      'aria-label': 'Amount saved for ' + g.name + ' from the ' + who + ' check',
      'data-focus-key': 'goal-rec-' + g.id,
      class: 'input',
    });
    const fld = field('How much did you put toward this from this check?', input);
    const btn = el(
      'button',
      {
        type: 'submit',
        class: 'btn btn-secondary btn-small',
        'aria-label': 'Save amount for ' + g.name + ' from the ' + who + ' check',
        'data-focus-key': 'goal-rec-save-' + g.id,
      },
      'Save',
    );
    const form = el(
      'form',
      { class: 'stack-sm', novalidate: true },
      fld,
      el('div', { class: 'cluster' }, btn),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = clean(input.value);
      const n = numOf(raw);
      if (raw === '' || raw === '-' || raw === '.' || !(n >= 0)) {
        fld.setError(
          n < 0 ? 'Amounts cannot be negative.' : 'Enter an amount, or 0 if you put nothing toward it.',
        );
        input.focus();
        return;
      }
      const again = p.recorded != null;
      recordContribution(g, p.payday, n, { planned: plannedNow });
      save();
      bus.rerender();
      toast(
        again
          ? 'Changed to ' + money(n) + ' from the ' + who + ' check.'
          : 'Saved ' + money(n) + ' from the ' + who + ' check.',
      );
    });
    out.push(form);
    out.push(
      el(
        'div',
        { class: 'hint' },
        p.recorded != null
          ? 'You put ' +
              money(p.recorded) +
              ' toward this from the ' +
              who +
              ' check. Enter a new amount to change it. It stays out of the money you have now until your next payday.'
          : 'Enter what you actually put away from this check. It then stops coming out of the money you have now until your next payday, and the plan adjusts so you still reach your goal.',
      ),
    );
  }
  const add = moneyInput({
    placeholder: 'Amount',
    'aria-label': 'Amount to add to ' + g.name,
    'data-focus-key': 'goal-add-' + g.id,
    class: 'input',
  });
  const addBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-small' }, 'Add to saved');
  addBtn.setAttribute('aria-label', 'Add extra money to ' + g.name);
  addBtn.addEventListener('click', () => {
    const n = numOf(add.value);
    if (!(n > 0)) {
      add.focus();
      toast('Enter an amount to add.');
      return;
    }
    recordContribution(g, null, n);
    save();
    bus.rerender();
  });
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBtn.click();
    }
  });
  out.push(el('div', { class: 'hint' }, 'Extra money any time (a gift, a bonus):'));
  out.push(el('div', { class: 'cluster' }, el('div', { style: 'flex:1;min-width:120px' }, add), addBtn));
  const hist = historyBox(B, g);
  if (hist) out.push(hist);
  return out;
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

/**
 * What the typical paycheck from one restaurant is, for comparing a plan to it: average take-home from finished periods,
 * else this period's projected check, plus regular other income over one of its pay periods.
 */
function typicalCheckOf(S, s) {
  const inc = expectedIncome(s.profile, s.nights, todayISO());
  const check = inc.avgTakeHomePerPeriod != null ? inc.avgTakeHomePerPeriod : inc.projectedCheck;
  if (check == null) return { base: null, other: 0 };
  const other = otherIncomePerPaycheck(S.budget, s.profile, todayISO()); // regular other income, spread over one pay period
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

/** "$150" for whole dollars, "$150.50" otherwise. */
const moneyShort = (n) => (Math.round(n * 100) % 100 === 0 ? money0(n) : money(n));

/** The "How we worked this out" rows for the amount that is possible to put aside. many: name the restaurants. */
function asideBreakdown(pa, many = false) {
  const rows = [
    row(
      (pa.checkFrom === 'average' ? 'Typical take-home per paycheck' : 'Projected take-home per paycheck') +
        (many ? ' from ' + pa.funderName : ''),
      money(pa.check),
    ),
  ];
  if (many) {
    rows.push(
      row('Your other restaurants over the same ' + pa.periodDays + ' days', '+' + money(pa.otherChecks)),
    );
    pa.otherChecksList.forEach((o) =>
      rows.push(row('   ' + o.name, o.known ? '+' + money(o.amount) : 'Not known yet', 'hint')),
    );
  }
  if (pa.other > 0) rows.push(row('Other regular income per paycheck', '+' + money(pa.other)));
  rows.push(row('Bills per paycheck', '−' + money(pa.bills)));
  rows.push(row('Spending categories per paycheck', '−' + money(pa.spending)));
  rows.push(row('Your other goals per paycheck', '−' + money(pa.goals)));
  pa.goalList.forEach((g) => rows.push(row('   ' + g.name, '−' + money(g.amount), 'hint')));
  rows.push(row('Room to put aside', money(pa.possible), 'total'));
  if (many)
    rows.push(
      row(
        'Bills, spending and goals are spread over every restaurant’s pay. One check never puts aside more than it brings in.',
        '',
        'hint',
      ),
    );
  return rows;
}

/** Scroll to a Budget card's heading and put keyboard focus on it (from "lower a spending category or another goal"). */
function goToCard(id) {
  const h = document.getElementById(id);
  if (!h) return;
  try {
    h.scrollIntoView({ block: 'start' });
  } catch (e) {
    /* ignore */
  }
  h.focus();
}

/**
 * The form for a savings goal (kind 'goal') or a big-purchase plan (kind 'plan'). With an item it edits that one.
 * Name, cost, already saved, and (with more than one restaurant) which restaurant's paychecks it is saved from. Then TipNet
 * shows what is safe to put aside from each of those paychecks, and a slider (linked to a money field) sets how much; it
 * only goes as high as the budget leaves (owner rule). The number of paychecks and the ready-by date follow it live.
 * Until TipNet knows what a check is, there is no slider: the amount is typed and marked an estimate.
 * A plan can instead be set by a date (that path may need more than the budget leaves; it says so).
 */
function goalForm(item, kind = 'plan') {
  const S = getState(),
    B = S.budget;
  const today = todayISO();
  const src = sourcesOf(S);
  const many = src.length > 1;
  const isPlanForm = kind === 'plan';
  const pre = 'ef-' + kind + '-' + (item ? item.id : 'new');
  const key = (k) => pre + '-' + k;
  const noun = isPlanForm ? 'plan' : 'goal';
  const name = el('input', {
    type: 'text',
    autocomplete: 'off',
    placeholder: isPlanForm ? 'Car down payment' : 'Emergency fund',
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
  const byDate = el('input', {
    type: 'date',
    min: addDays(today, 1),
    value: item && item.targetDate ? item.targetDate : '',
    'data-focus-key': key('date'),
  });
  // Which restaurant's paychecks it is saved from (only asked when there is more than one).
  let funder = funderFor(item, src);
  const funderSel = many
    ? select(
        src.map((s) => [s.id, s.name]),
        funder.id,
        { 'data-focus-key': key('funder'), id: key('funder') },
      )
    : null;
  // What is possible comes from the budget alone, so it is worked out once per restaurant (the goal being edited is left out).
  const paFor = (f) =>
    possibleAside(B, null, null, today, {
      sources: src,
      funderId: f.id,
      excludeId: item ? item.id : undefined,
    });
  let pa = paFor(funder);
  let tc = typicalCheckOf(S, funder);
  const hasOwn = !!(item && !item.targetDate && Number(item.perPaycheck) > 0);
  const perCheck = moneyInput({
    placeholder: '0.00',
    value: hasOwn ? String(item.perPaycheck) : '',
    'data-focus-key': key('per'),
  });
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: String(ASIDE_STEP),
    step: String(ASIDE_STEP),
    'data-focus-key': key('slider'),
  });
  let mode = isPlanForm && item && item.targetDate ? 'date' : 'fixed';
  let touched = hasOwn; // once an amount is chosen, the slider stops following the starting amount

  const fName = field(isPlanForm ? 'What is it?' : 'Goal name', name),
    fCost = field(isPlanForm ? 'How much does it cost?' : 'How much do you need?', cost),
    fSaved = field('Already saved', saved, { optional: true }),
    fFunder = funderSel
      ? field('Save from which paycheck?', funderSel, {
          hint: 'The paydays and the typical check of that restaurant set the plan.',
        })
      : null,
    fDate = field('Date you want it by', byDate),
    fSlider = field('How much do you want to put aside each paycheck?', slider),
    fPer = field('Or type an amount a paycheck', perCheck);
  const perLabel = fPer.querySelector('label');
  const possibleBox = el('div', { class: 'stack-sm', id: pre + '-possible' });
  const capNote = el('p', { class: 'hint', role: 'status', id: pre + '-cap' });
  const live = el('p', { class: 'num', role: 'status', 'aria-live': 'polite', id: pre + '-live' });
  const extra = el('div', { class: 'stack-sm', id: pre + '-extra' });
  const preview = el('div', { class: 'stack-sm', id: pre + '-preview' });
  // Only a plan can be set by a date; a plain goal is always an amount a paycheck.
  const toDate = isPlanForm
    ? el(
        'button',
        {
          type: 'button',
          class: 'btn-link',
          'data-focus-key': key('to-date'),
          onclick: () => {
            mode = 'date';
            refresh();
            byDate.focus();
          },
        },
        'Need it by a certain date?',
      )
    : null;
  const toAmount = isPlanForm
    ? el(
        'button',
        {
          type: 'button',
          class: 'btn-link',
          'data-focus-key': key('to-amount'),
          onclick: () => {
            mode = 'fixed';
            refresh();
            if (!slider.disabled && !fSlider.hidden) slider.focus();
            else perCheck.focus();
          },
        },
        'Choose an amount a paycheck instead',
      )
    : null;
  const draft = () => {
    const d = {
      kind: 'purchase',
      name: name.value.trim(),
      target: Math.max(0, numOf(cost.value)),
      saved: Math.max(0, numOf(saved.value)),
      createdAt: today,
    };
    d.startSaved = d.saved;
    if (mode === 'date') d.targetDate = byDate.value;
    else d.perPaycheck = Math.max(0, numOf(perCheck.value));
    return d;
  };
  /** The slider's range for what is still missing. */
  const rangeNow = () => {
    const d = draft();
    return asideRange(pa.possible, Math.max(0, d.target - d.saved), pa.known);
  };
  const CAP_TEXT =
    'That’s the most your budget leaves each paycheck. Lower spending or other goals to save more.';
  /** Keep the typed amount within what the budget leaves (when that is known). Returns the amount. */
  const clampTyped = () => {
    const rg = rangeNow();
    let per = Math.max(0, numOf(perCheck.value));
    if (rg.capped && per > rg.max) {
      per = rg.max;
      perCheck.value = per > 0 ? String(per) : '';
      capNote.textContent = CAP_TEXT;
    } else if (!(rg.capped && per === rg.max && capNote.textContent)) capNote.textContent = '';
    return per;
  };
  const howLink = () =>
    el(
      'details',
      null,
      el('summary', { class: 'btn-link' }, 'How we worked this out'),
      el('dl', { class: 'breakdown', style: 'padding-top:var(--s-2)' }, ...asideBreakdown(pa, many)),
      el('p', { class: 'hint' }, 'All figures are estimates.'),
    );
  const refresh = () => {
    const d = draft();
    const rg = rangeNow();
    fDate.hidden = mode !== 'date';
    fPer.hidden = mode !== 'fixed';
    // No slider until TipNet knows what a check is: the amount is typed (an estimate, no cap).
    fSlider.hidden = mode !== 'fixed' || !rg.capped;
    possibleBox.hidden = live.hidden = extra.hidden = capNote.hidden = mode !== 'fixed';
    preview.hidden = mode !== 'date';
    if (toDate) toDate.hidden = mode !== 'fixed';
    if (toAmount) toAmount.hidden = mode !== 'date';
    perLabel.textContent = rg.capped
      ? 'Or type an amount a paycheck'
      : 'Amount a paycheck (an estimate for now)';
    clear(possibleBox);
    clear(extra);
    clear(preview);
    live.textContent = '';
    if (mode === 'date') {
      if (!(d.target > 0) || !d.targetDate || d.targetDate <= today) return;
      const plan = purchasePlan(d, funder.profile, today);
      preview.append(
        ...planLines(plan, tc).map((t, i) => el('p', i === 0 ? { class: 'num' } : { class: 'hint' }, t)),
      );
      if (pa.known && !plan.ready && !plan.noPaychecks && plan.perPaycheck > rg.max)
        preview.append(
          el(
            'p',
            { class: 'note' },
            'That’s more than your budget leaves each paycheck (up to ' +
              moneyShort(rg.max) +
              '). A later date lowers it, or lower spending or another goal.',
          ),
        );
      return;
    }
    slider.disabled = perCheck.disabled = rg.capped && rg.disabled;
    if (!(d.target > 0)) {
      possibleBox.append(
        el('p', { class: 'hint' }, 'Enter what you need and TipNet will show what is safe to put aside.'),
      );
      slider.max = String(Math.max(ASIDE_STEP, rg.max || 0));
      slider.value = String(Math.min(Number(slider.max), Math.max(0, numOf(perCheck.value))));
      return;
    }
    if (!rg.capped) {
      possibleBox.append(
        el(
          'p',
          { class: 'hint' },
          'We’ll know what’s safe to put aside after your first pay period' +
            (many ? ' at ' + funder.name : '') +
            '. Until then, type an amount; it’s an estimate, and TipNet checks it against your budget the next time you edit this ' +
            noun +
            '.',
        ),
      );
    } else if (rg.disabled) {
      const toSpend = el(
        'button',
        { type: 'button', class: 'btn-link', onclick: () => goToCard('budget-spending-heading') },
        'Edit spending',
      );
      const toGoals = el(
        'button',
        { type: 'button', class: 'btn-link', onclick: () => goToCard('budget-goals-heading') },
        'Edit your other goals',
      );
      possibleBox.append(
        el(
          'p',
          { class: 'note' },
          'Your budget doesn’t leave anything to put aside from each ' +
            (many ? funder.name + ' ' : '') +
            'paycheck right now: bills, spending and your other goals use it all. Lower a spending category or another goal to make room.',
        ),
        el('div', { class: 'cluster' }, toSpend, toGoals),
        howLink(),
      );
    } else {
      possibleBox.append(
        el(
          'p',
          { class: 'num' },
          'Up to ' +
            moneyShort(rg.max) +
            ' a paycheck is safe to put aside' +
            (many ? ' from ' + funder.name : '') +
            ' — that’s what your budget leaves after bills, spending and your other goals.',
        ),
        howLink(),
      );
    }
    // Until the person picks an amount, it starts at what is safe, or less when that finishes the goal in one paycheck.
    if (!touched && rg.capped) perCheck.value = rg.start > 0 ? String(rg.start) : '';
    const per = rg.capped && rg.disabled ? 0 : clampTyped();
    if (rg.capped) {
      slider.max = String(Math.max(ASIDE_STEP, rg.max));
      slider.value = String(Math.min(rg.max, per));
      slider.setAttribute('aria-valuetext', moneyShort(Math.min(rg.max, per)) + ' a paycheck');
    }
    if (rg.capped && rg.disabled) return;
    const p = purchasePlan({ ...d, perPaycheck: per }, funder.profile, today);
    if (p.ready) live.textContent = 'You already have enough saved for this.';
    else if (!(per > 0))
      live.textContent = rg.capped
        ? 'Move the slider or type an amount to see how long it takes.'
        : 'Type an amount to see how long it takes.';
    else
      live.textContent =
        moneyShort(per) +
        ' a paycheck' +
        (rg.capped ? '' : ' (estimate)') +
        ' → about ' +
        plural(p.paychecksLeft, 'paycheck') +
        (p.readyBy ? ' → ready by about ' + fmtDate(p.readyBy) : '');
    if (!p.ready && per > 0) {
      const sh = planShare(per, tc.base);
      extra.append(
        el(
          'p',
          { class: 'hint' },
          !sh
            ? "We'll compare it to your paychecks once you have a finished pay period."
            : "That's about " +
                sh.pct +
                '% of a typical ' +
                (many ? funder.name + ' ' : '') +
                'check' +
                (tc.other > 0 ? ' plus your regular other income.' : '.'),
        ),
      );
    }
  };
  const submit = el(
    'button',
    { type: 'submit', class: 'btn btn-small', 'data-focus-key': item ? key('submit') : 'add-' + kind },
    item ? 'Save ' + noun : isPlanForm ? 'Make this plan' : 'Add goal',
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
      'aria-label': item
        ? 'Edit ' + noun + ' ' + item.name
        : isPlanForm
          ? 'Plan a big purchase'
          : 'Add a savings goal',
    },
    fName,
    fCost,
    fSaved,
    fFunder,
    possibleBox,
    fSlider,
    fPer,
    capNote,
    live,
    extra,
    fDate,
    preview,
    toDate,
    toAmount,
    el('div', { class: 'cluster' }, submit, cancel),
  );
  if (funderSel)
    funderSel.addEventListener('change', () => {
      funder = src.find((s) => s.id === funderSel.value) || funder;
      pa = paFor(funder);
      tc = typicalCheckOf(S, funder);
      if (!hasOwn) touched = false; // a new goal starts again from what is safe from that restaurant
      refresh();
    });
  slider.addEventListener('input', () => {
    touched = true;
    perCheck.value = slider.value === '0' ? '' : slider.value;
    refresh();
  });
  perCheck.addEventListener('input', () => {
    touched = true;
  });
  form.addEventListener('input', (e) => {
    if (e.target !== slider && e.target !== funderSel) refresh();
  });
  form.addEventListener('change', (e) => {
    if (e.target !== funderSel) refresh();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (mode === 'fixed') clampTyped();
    const d = draft();
    const rg = rangeNow();
    let bad = false;
    const check = (f, msg) => {
      f.setError(msg);
      if (msg) bad = true;
    };
    check(fName, d.name ? '' : 'Give it a name.');
    check(fCost, d.target > 0 ? '' : 'Enter an amount above zero.');
    check(fSaved, '');
    check(fDate, mode === 'date' && !(d.targetDate > today) ? 'Pick a date after today.' : '');
    check(
      fPer,
      mode !== 'fixed' || d.perPaycheck > 0 || d.target - d.saved <= 0
        ? ''
        : rg.capped && rg.disabled
          ? 'Your budget leaves nothing to put aside right now. Lower spending or another goal first.'
          : 'Enter an amount above zero.',
    );
    if (bad) {
      const first = form.querySelector('[aria-invalid]');
      if (first) first.focus();
      return;
    }
    const p = purchasePlan(d, funder.profile, today);
    const fields = {
      name: d.name,
      target: d.target,
      saved: d.saved,
      perPaycheck: mode === 'date' ? p.perPaycheck : d.perPaycheck,
    };
    if (isPlanForm) fields.kind = 'purchase';
    if (mode === 'date') fields.targetDate = d.targetDate;
    if (many) fields.fundedBy = funder.id;
    // The schedule a goal is measured against starts when it is made, or again when its numbers (or its paycheck) change.
    const changed =
      !item ||
      isPlanForm ||
      (many && item.fundedBy !== funder.id) ||
      ['target', 'saved', 'perPaycheck'].some(
        (k) => Math.round((Number(item[k]) || 0) * 100) !== Math.round(fields[k] * 100),
      );
    if (changed) {
      fields.createdAt = today;
      fields.startSaved = d.saved;
    }
    if (item) {
      delete item.targetDate;
      Object.assign(item, fields);
    } else B.goals.push({ id: newId('g'), ...fields });
    editing = null;
    save();
    bus.rerender();
    toast(item ? 'Saved.' : isPlanForm ? 'Plan added.' : 'Added.');
  });
  refresh();
  return form;
}

/** The lines, status and controls that follow a goal's progress bar. */
function trackerBody(S, g, p, tc) {
  const st = statusText(g, p);
  const body = st ? [el('div', null, el('b', null, st))] : [];
  if (p.ready) return body;
  const t = trackerLines(g, p, tc);
  t.lines.forEach(([text, hint], i) =>
    body.push(el('p', hint ? { class: 'hint' } : i === 0 ? { class: 'num' } : null, text)),
  );
  if (t.move && isPlan(g) && g.targetDate)
    body.push(
      el(
        'div',
        { class: 'cluster' },
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn-secondary btn-small',
            'aria-label': 'Move the date for ' + g.name,
            'data-focus-key': 'plan-move-' + g.id,
            onclick: () => {
              editing = { kind: 'plan', id: g.id };
              bus.rerender();
            },
          },
          'Move the date',
        ),
      ),
    );
  return body;
}

/** "Saved from Second Spot paychecks" under a goal, when there is more than one restaurant. */
const funderLine = (f, many) =>
  many ? el('div', { class: 'hint' }, 'Saved from ' + f.name + ' paychecks.') : null;

function planRow(S, g, src) {
  const B = S.budget;
  if (isEditing('plan', g.id))
    return el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, goalForm(g, 'plan')));
  const f = funderFor(g, src);
  const many = src.length > 1;
  const tc = typicalCheckOf(S, f);
  const p = purchasePlan(g, f.profile, todayISO());
  const head = [
    el('div', { class: 'spread' }, el('span', null, g.name), el('b', { class: 'num' }, p.pct + '%')),
    bar(p.pct, g.name + ' progress'),
    el('div', { class: 'hint' }, money(g.saved) + ' saved of ' + money(g.target) + '.'),
    funderLine(f, many),
  ];
  const body = trackerBody(S, g, p, tc);
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
    body.push(
      el(
        'div',
        { class: 'hint' },
        (g.targetDate ? 'Wanted by ' + fmtDate(g.targetDate) + '. ' : '') +
          'The amount is worked out again after each check you record (estimated).',
      ),
    );
  }
  body.push(...goalControls(B, g, p, f, many));
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
  const src = sourcesOf(S);
  const many = src.length > 1;
  const rows = B.goals
    .filter((g) => !g.boughtAt)
    .map((g) => {
      if (isPlan(g)) return planRow(S, g, src);
      if (isEditing('goal', g.id))
        return el('li', { class: 'list-row wrap' }, el('div', { class: 'main' }, goalForm(g, 'goal')));
      const f = funderFor(g, src);
      const tc = typicalCheckOf(S, f);
      const p = purchasePlan(g, f.profile, todayISO());
      return el(
        'li',
        { class: 'list-row wrap' },
        el(
          'div',
          { class: 'main stack-sm' },
          el('div', { class: 'spread' }, el('span', null, g.name), el('b', { class: 'num' }, p.pct + '%')),
          bar(p.pct, g.name + ' progress'),
          el('div', { class: 'hint' }, money(g.saved) + ' of ' + money(g.target) + '.'),
          funderLine(f, many),
          ...trackerBody(S, g, p, tc),
          ...goalControls(B, g, p, f, many),
        ),
        el('div', { class: 'row-actions' }, editBtn('goal', g.id, 'Edit ' + g.name), goalRemoveBtn(B, g, '')),
      );
    });
  const done = B.goals.filter((g) => g.boughtAt);
  return el(
    'section',
    { class: 'card stack' },
    el('h2', { id: 'budget-goals-heading', tabindex: '-1' }, 'Savings goals'),
    rows.length
      ? el('ul', { class: 'list' }, rows)
      : el(
          'p',
          { class: 'hint' },
          'No goals yet. A goal is something you are saving toward, like an emergency fund.',
        ),
    el(
      'details',
      {
        class: 'card',
        open: !!addOpen.goal,
        ontoggle: (e) => {
          addOpen.goal = e.target.open;
        },
      },
      el('summary', null, 'Add a savings goal'),
      el('div', { style: 'padding-top:var(--s-2)' }, goalForm(null, 'goal')),
    ),
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
      el('div', { style: 'padding-top:var(--s-2)' }, goalForm(null, 'plan')),
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
    B.paidBills = convertPaidKeys(B.paidBills, B.bills, S.workplaces[0].profile); // the only pay schedule there was then
    save();
  }
  // Worked out once per render and shared by the cards below (none of them needs it recomputed).
  const src = sourcesOf(S);
  const r0 = safeToSpendAll(B, src, todayISO());
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
    heroCard(S, r0, src),
    nextCheckCard(S, r0, src),
    billsCard(S, r0, src),
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
