// The harness clock: the time-of-day pin follows a fake moment's time (run-dates night runs), and a test that installs
// mock.timers without boot({ time: null }) fails loudly instead of having its mocked clock silently replaced.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { boot, DEFAULT_TIME } from './harness.js';

const pad = (n) => String(n).padStart(2, '0');

test('harness: the default time of day is the fake moment’s time when it has one, else 14:00', async () => {
  const t = /T(\d{2}:\d{2})$/.exec(process.env.TIPNET_FAKE_TODAY || '');
  assert.equal(DEFAULT_TIME, t ? t[1] : '14:00');
  const page = await boot();
  try {
    const d = new Date();
    // the clock keeps ticking from the pin: allow a minute
    const mins = d.getHours() * 60 + d.getMinutes();
    const [h, m] = DEFAULT_TIME.split(':').map(Number);
    assert.ok(Math.abs(mins - (h * 60 + m)) <= 1, pad(d.getHours()) + ':' + pad(d.getMinutes()));
  } finally {
    await page.close();
  }
});

test('harness: mock.timers with the time-of-day pin still on throws a clear error', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 30, 3, 15) });
  try {
    await assert.rejects(boot(), /mock\.timers\?.*boot\(\{ time: null \}\)/);
    const page = await boot({ time: null }); // the documented way: the mocked clock is used
    try {
      assert.equal(new Date().getHours(), 3);
    } finally {
      await page.close();
    }
  } finally {
    mock.timers.reset();
  }
});
