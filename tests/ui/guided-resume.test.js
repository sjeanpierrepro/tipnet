// Sixth review: a guided setup saved by v37 (no shift count then) and resumed at step 3 could finish without the
// now-required "Shifts you work in a pay period": Finish only checked the step on screen. Next and Finish now check
// every required value of the steps so far and send the person to the first one missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './harness.js';
import { seedState } from '../../app/js/storage.js';
import { todayISO, addDays } from '../../app/js/math.js';

const v37Draft = (step) => {
  const S = seedState(); // the example (profileExample, nightsExample)
  S.schemaVersion = 3;
  S.settings.guidedDraft = {
    workplaceId: S.workplaces[0].id,
    step,
    profile: {
      freq: 14,
      periodStart: addDays(todayISO(), -3),
      periodEnd: '',
      payDelay: 1,
      shifts: 0,
      gross: 1600,
      rateOverride: null,
      deductions: [{ id: 'd1', k: 'fed', name: 'Federal income tax', amount: 160, mode: 'pct' }],
      payTypes: [{ id: 'p1', k: 'bartender', name: 'Bartender', rate: 11, unit: 'hr', usual: 0 }],
      tipout: { on: false },
      tipouts: [],
    },
  };
  return S;
};
const current = (page) => page.$('.steps [aria-current="step"]').textContent;

for (const [step, verb] of [
  [2, 'Finish setup'],
  [1, 'Next'],
]) {
  test(
    'a v37 guided setup resumed at step ' +
      (step + 1) +
      ': ' +
      verb +
      ' goes back to the missing shift count',
    async () => {
      const page = await boot({ seed: v37Draft(step) });
      try {
        page.tab('setup');
        await page.settle();
        assert.equal(current(page), step + 1 + (step === 2 ? '. Pay and tip-out' : '. Deductions'));
        page.click(page.button(verb));
        await page.settle();
        assert.equal(page.state().workplaces[0].setupDone, undefined, 'not finished');
        assert.equal(current(page), '1. Pay period and gross');
        const shifts = page.must(page.$('input[placeholder="e.g. 10"]', page.app), 'shift count box');
        assert.equal(page.doc.activeElement, shifts, 'focus on the missing box');
        assert.equal(shifts.getAttribute('aria-invalid'), 'true');
        page.type(shifts, '10');
        page.click(page.button('Next'));
        page.click(page.button('Next'));
        page.click(page.button('Finish setup'));
        await page.settle();
        const w = page.state().workplaces[0];
        assert.equal(w.setupDone, true);
        assert.equal(w.profile.shifts, 10);
      } finally {
        await page.close();
      }
    },
  );
}
