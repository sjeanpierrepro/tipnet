// Messages about what is being typed never interrupt (second v38 review): typing "7:30", "$45" or "1,250" one key at a
// time raises nothing on the way ("7:", "$", "1,"), and a real typo is flagged after a pause in typing (800 ms) or when
// the box is left, as a polite message linked to the box (never role="alert"). Save still refuses a typo at once, and
// what Save refuses is an alert. Mock timers: boot({ time: null }) (see harness.js).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { todayISO, addDays, exampleProfile } from '../../app/js/math.js';
import { TYPO_PAUSE_MS } from '../../app/js/ui/common.js';

const today = todayISO();
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const AMOUNT = /That isn’t an amount\. Use numbers and one decimal point, like 12\.50\./;
const RUNNER = { id: 't2', k: 'runner', who: 'Runner', mode: 'flat', value: 12.5, from: 'payroll' };
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    const start = addDays(today, -3);
    S.workplaces[0].profile = {
      ...exampleProfile(today),
      periodStart: start,
      periodEnd: addDays(start, 13),
      freq: 14,
      tipout: { on: true, basis: 'before' },
      tipouts: [{ ...BARBACK }, { ...RUNNER }],
    };
    if (mutate) mutate(S);
  });
/** The messages on screen: [{text, alert, polite}]. */
const shown = (page) =>
  page
    .$$('.field-error, [role=alert]')
    .filter((e) => !e.hidden && e.textContent.trim() && !e.closest('[hidden]'))
    .map((e) => ({
      text: e.textContent,
      alert: e.getAttribute('role') === 'alert',
      polite: e.getAttribute('aria-live') === 'polite' || e.getAttribute('role') === 'status',
    }));
/** The error line linked to a box (through its aria-describedby), '' when none is shown. */
const errOf = (page, input) => {
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/);
  const e = ids.map((i) => page.doc.getElementById(i)).find((n) => n && n.classList.contains('field-error'));
  return e && !e.hidden ? e : null;
};
/** Its text (so a failing check never prints a whole DOM node). */
const msgOf = (page, input) => (errOf(page, input) ? errOf(page, input).textContent : '');
const invalid = (input) => input.getAttribute('aria-invalid') === 'true';
/** Type text one key at a time, a short gap between keys (well under the pause). */
function typeKeys(page, input, text, after = () => {}) {
  for (let i = 1; i <= text.length; i++) {
    page.type(input, text.slice(0, i));
    after(text.slice(0, i));
    mock.timers.tick(150);
  }
}
async function withTimers(seedState, fn, url) {
  mock.timers.enable({ apis: ['setTimeout'] });
  const page = await boot({ seed: seedState, time: null, ...(url ? { url } : {}) });
  try {
    await fn(page);
  } finally {
    mock.timers.reset();
    await page.close();
  }
}

test('Tonight: typing 7:30, $45 and 1,250 key by key raises no message on the way', async () => {
  await withTimers(seed(), async (page) => {
    const none = (box) => (v) => assert.deepEqual(shown(page), [], box + ' ' + JSON.stringify(v));
    typeKeys(page, key(page, 'night-pay-p1'), '7:30', none('hours'));
    mock.timers.tick(TYPO_PAUSE_MS);
    assert.deepEqual(shown(page), []);
    typeKeys(page, key(page, 'night-total'), '$45', none('tips'));
    typeKeys(page, key(page, 'night-total'), '1,250', none('tips'));
    typeKeys(page, key(page, 'night-cash'), '$1,00', none('cash'));
    mock.timers.tick(TYPO_PAUSE_MS);
    assert.deepEqual(shown(page), []);
    assert.equal(page.$('.quick-net').hidden, false);
  });
});

test('Tonight: a typo is flagged after a pause in typing, politely and linked to its box; fixing it clears it at once', async () => {
  await withTimers(seed(), async (page) => {
    const total = key(page, 'night-total');
    const hours = key(page, 'night-pay-p1');
    page.type(hours, '7');
    page.type(total, '1.2.3');
    // the preview says so at once (no numbers from a typo), but nothing is flagged or alerted yet
    assert.match(page.$('.result').textContent, /Fix the \w+ marked above/);
    assert.deepEqual(shown(page), []);
    assert.equal(invalid(total), false);
    mock.timers.tick(TYPO_PAUSE_MS - 1);
    assert.deepEqual(shown(page), []);
    mock.timers.tick(1);
    assert.deepEqual(shown(page), [{ text: shown(page)[0].text, alert: false, polite: true }]);
    assert.match(errOf(page, total).textContent, AMOUNT);
    assert.equal(invalid(total), true);
    // still a typo while typing on: it stays; fixed: gone at once
    page.type(total, '1.2.34');
    assert.match(errOf(page, total).textContent, AMOUNT);
    page.type(total, '1.2');
    assert.equal(msgOf(page, total), '');
    assert.equal(invalid(total), false);
    // hours: a typo waits the same way
    page.type(hours, '7..5');
    assert.deepEqual(shown(page), []);
    mock.timers.tick(TYPO_PAUSE_MS);
    const h = errOf(page, hours);
    assert.match(h.textContent, /Hours should be a number, like 6 or 7:30\./);
    assert.equal(h.getAttribute('role'), null, 'not an alert');
    assert.equal(h.getAttribute('aria-live'), 'polite');
    assert.equal(invalid(hours), true);
    page.type(hours, '7.5');
    assert.equal(msgOf(page, hours), '');
    // more than 24 hours is not a typo: said at once
    page.type(hours, '30');
    assert.match(errOf(page, hours).textContent, /more than 24 hours/);
  });
});

test('Tonight: leaving the box shows its typo at once; Save refuses a typo at once, as an alert', async () => {
  await withTimers(seed(), async (page) => {
    const total = key(page, 'night-total');
    const cash = key(page, 'night-cash');
    page.type(key(page, 'night-pay-p1'), '7');
    page.type(cash, '1.2.3');
    assert.deepEqual(shown(page), []);
    page.leave(cash);
    assert.match(errOf(page, cash).textContent, AMOUNT);
    assert.equal(
      shown(page).some((m) => m.alert),
      false,
    );
    page.type(cash, '100');
    assert.equal(msgOf(page, cash), '');
    // Save right after typing a typo (no pause, box not left): refused at once, as an alert, nothing stored
    page.type(total, '5.0.0');
    page.click(page.button('Save night'));
    assert.equal(page.state().nights.length, 0);
    const e = errOf(page, total);
    assert.match(e.textContent, AMOUNT);
    assert.equal(e.getAttribute('role'), 'alert');
    assert.equal(page.doc.activeElement, total);
    // typing on: no alert any more; the message comes back politely after a pause
    page.type(total, '5.0.05');
    assert.equal(
      shown(page).some((m) => m.alert),
      false,
    );
    mock.timers.tick(TYPO_PAUSE_MS);
    assert.match(errOf(page, total).textContent, AMOUNT);
    assert.equal(errOf(page, total).getAttribute('role'), null);
    // a missing amount on Save is an alert too
    page.type(total, '');
    page.click(page.button('Save night'));
    assert.equal(errOf(page, total).getAttribute('role'), 'alert');
    assert.match(errOf(page, total).textContent, /Enter what you made tonight first\./);
  });
});

test('Pay periods night editor: a typo waits for a pause too', async () => {
  const night = {
    id: 'n1',
    date: addDays(today, -1),
    total: 500,
    cash: 200,
    pay: { p1: 8 },
    barback: true,
    tipouts: { t1: true, t2: false },
    workplaceId: 'w1',
  };
  await withTimers(
    seed((S) => {
      S.nights = [night];
    }),
    async (page) => {
      page.tab('periods');
      page.click(
        page.$$('button', page.app).find((b) => b.getAttribute('data-focus-key') === 'edit-n1-total'),
      );
      const hours = key(page, 'edit-n1-pay-p1');
      typeKeys(page, hours, '7:45', () => assert.deepEqual(shown(page), []));
      page.type(hours, '7..5');
      assert.deepEqual(shown(page), []);
      assert.match(page.text(page.app), /Fix the \w+ marked above to see the estimate\./);
      mock.timers.tick(TYPO_PAUSE_MS);
      assert.match(errOf(page, hours).textContent, /Hours should be a number/);
      assert.equal(errOf(page, hours).getAttribute('role'), null);
    },
  );
});

test('Setup: a typo in a box is flagged after a pause, but Save is off at once', async () => {
  await withTimers(seed(), async (page) => {
    page.openSetup();
    const gross = page.byText('.field', 'Gross pay', page.app).querySelector('input');
    page.type(gross, '$');
    assert.equal(page.$('#draft-save').disabled, true, 'Save refuses the typo at once');
    assert.match(page.text(page.$('#draft-reasons')), /Gross pay/);
    assert.equal(msgOf(page, gross), '', 'no message mid-typing');
    typeKeys(page, gross, '$2,100', () => assert.equal(msgOf(page, gross), ''));
    page.type(gross, '2.1.0');
    mock.timers.tick(TYPO_PAUSE_MS);
    assert.match(errOf(page, gross).textContent, AMOUNT);
    assert.equal(
      shown(page).some((m) => m.alert),
      false,
    );
    // a tip-out percent: "15%" on the way is fine, "1.5.%" is flagged after the pause
    const amt = key(page, 'tv-t1');
    typeKeys(page, amt, '15%', () => assert.equal(msgOf(page, amt), ''));
    page.type(amt, '1.5.');
    assert.equal(msgOf(page, amt), '');
    mock.timers.tick(TYPO_PAUSE_MS);
    assert.match(errOf(page, amt).textContent, /percent/);
    // shifts (checked again by the card on every change): also only after the pause
    const shifts = page.byText('.field', 'Shifts', page.app).querySelector('input');
    page.type(shifts, '1,2,3');
    assert.equal(msgOf(page, shifts), '');
    mock.timers.tick(TYPO_PAUSE_MS);
    assert.match(errOf(page, shifts).textContent, /number of shifts/);
  });
});

test('Budget: "Money you have right now" flags a typo after a pause, not on "$" or "1,"', async () => {
  await withTimers(
    realState((S) => {
      S.workplaces[0].setupDone = true;
    }),
    async (page) => {
      page.tab('budget');
      const input = page.must(page.$('#budget-balance'), 'balance');
      typeKeys(page, input, '$1,500', () => assert.equal(msgOf(page, input), ''));
      page.type(input, '1.5.0');
      assert.equal(msgOf(page, input), '');
      mock.timers.tick(TYPO_PAUSE_MS);
      assert.match(errOf(page, input).textContent, AMOUNT);
      assert.equal(errOf(page, input).getAttribute('role'), null);
    },
    'http://localhost/?unlock=dev',
  );
});
