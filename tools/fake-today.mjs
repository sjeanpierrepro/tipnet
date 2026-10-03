// Preloaded by tools/run-dates.mjs (node --import): when TIPNET_FAKE_TODAY=YYYY-MM-DD[THH:MM] is set, the clock starts
// at that moment (noon when no time is given) and keeps ticking from there. `new Date()` and `Date.now()` see the fake
// time; dates built from explicit values are unchanged. Without the variable this file does nothing.
import process from 'node:process';
const fake = process.env.TIPNET_FAKE_TODAY;
if (fake) {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(fake))
    throw new Error('TIPNET_FAKE_TODAY must look like 2026-10-05 or 2026-10-05T01:30');
  const RealDate = Date;
  const offset =
    new RealDate(fake.length === 10 ? fake + 'T12:00:00' : fake + ':00').getTime() - RealDate.now();
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
