// npm run test:dates runs the suite with a fake "today" (tools/fake-today.mjs). This checks the fake clock took effect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { todayISO } from '../app/js/math.js';

const fake = (process.env.TIPNET_FAKE_TODAY || '').slice(0, 10);
test(
  'the fake clock of npm run test:dates reaches the tests',
  { skip: !process.env.TIPNET_FAKE_TODAY && 'real clock' },
  () => {
    assert.equal(todayISO(), fake);
    assert.equal(todayISO(new Date(Date.now())), fake);
    assert.equal(new Date(2020, 0, 2).getDate(), 2, 'explicit dates are unchanged');
  },
);
