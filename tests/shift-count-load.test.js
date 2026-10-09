// The shift count the update gives an establishment (see shift-count.test.js) is saved right away, so loading again
// after a pay period ends can't work it out again from a history that has changed since.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayISO } from '../app/js/math.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

test('loading a save without a shift count writes the count it was given', async () => {
  const t = todayISO();
  const night = (id, date) => ({
    id,
    date,
    total: 250,
    tips: 200,
    cash: 50,
    pay: { p1: 10 },
    barback: false,
    tipoutOn: false,
    tipouts: {},
    workplaceId: 'w1',
  });
  const nights = [];
  // a finished pay period with 6 nights, and 2 in the running one
  for (let i = 0; i < 6; i++) nights.push(night('o' + i, addDays(t, -40 + i)));
  for (let i = 0; i < 2; i++) nights.push(night('r' + i, addDays(t, -3 + i)));
  const raw = {
    schemaVersion: 4,
    profileExample: false,
    nightsExample: false,
    workplaces: [
      {
        id: 'w1',
        name: 'Bar',
        setupDone: true,
        calib: [],
        profile: {
          freq: 14,
          periodStart: addDays(t, -41),
          periodEnd: '',
          shifts: 0,
          gross: 2000,
          deductions: [{ id: 'd1', k: 'fed', name: 'Fed', amount: 200, mode: 'pct' }],
          payTypes: [{ id: 'p1', k: 'bartender', name: 'Bartender', rate: 5, unit: 'hr', usual: 0 }],
          tipout: { on: false },
          tipouts: [],
        },
      },
    ],
    nights,
    budget: {},
    settings: { wordingV38: true },
    _savedAt: 5000,
  };
  mem.set('tipnet.v2', JSON.stringify(raw));
  const s = await import('../app/js/storage.js?shiftcount');
  s._setIdbWait(20);
  const st = await s.load();
  assert.equal(st.workplaces[0].profile.shifts, 6);
  // no explicit flush: the load itself schedules the save (as a lock or a pinned tip-out does)
  s.lockFinished();
  await new Promise((r) => setTimeout(r, 700));
  const stored = JSON.parse(mem.get('tipnet.v2'));
  assert.equal(stored.workplaces[0].profile.shifts, 6);
});
