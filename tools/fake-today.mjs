// Preloaded by tools/test-dates.mjs (node --import): when TIPNET_FAKE_TODAY=YYYY-MM-DD is set, the clock starts at noon
// on that day and keeps ticking from there. `new Date()` and `Date.now()` see the fake time; dates built from explicit
// values are unchanged. Without the variable this file does nothing.
import process from 'node:process';
const fake = process.env.TIPNET_FAKE_TODAY;
if (fake) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fake)) throw new Error('TIPNET_FAKE_TODAY must look like 2026-10-05');
  const RealDate = Date;
  const offset = new RealDate(fake + 'T12:00:00').getTime() - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = FakeDate;
}
