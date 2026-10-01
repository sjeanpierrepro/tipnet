// Runs the whole test suite as if today were each of a few awkward dates, so no test depends on the real calendar.
// Usage: npm run test:dates   (or: node tools/run-dates.mjs 2026-10-05 2027-01-01)
// Named run-dates (not test-*) so a plain `node --test` never picks it up as a test file and "passes" without running anything.
// Each run sets TIPNET_FAKE_TODAY and preloads tools/fake-today.mjs into every test process via NODE_OPTIONS.
// A run that fails, skips, or finds no tests fails this script.
import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preload = pathToFileURL(path.join(root, 'tools', 'fake-today.mjs')).href;
// Right after the example pay period ends (the old time bomb), a new year, and a leap day.
const dates = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['2026-10-05', '2027-01-01', '2028-02-29'];
const testGlob = 'tests/**/*.test.js';

const failed = [];
for (const d of dates) {
  console.log('\n=== node --test with today = ' + d + ' ===');
  const r = spawnSync(process.execPath, ['--test', testGlob], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      TIPNET_FAKE_TODAY: d,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=' + preload].filter(Boolean).join(' '),
    },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const num = (name) => {
    const m = out.match(new RegExp('^\\S*\\s*' + name + ' (\\d+)\\s*$', 'm'));
    return m ? Number(m[1]) : null;
  };
  const tests = num('tests');
  const pass = num('pass');
  const fail = num('fail');
  const skipped = num('skipped');
  if (r.status !== 0) {
    console.error(
      out
        .split('\n')
        .filter((l) => /not ok|fail|error/i.test(l))
        .slice(0, 40)
        .join('\n'),
    );
  }
  console.log(`  tests ${tests}, pass ${pass}, fail ${fail}, skipped ${skipped}`);
  if (r.status !== 0 || !tests || fail !== 0 || skipped || pass !== tests || /recursively/i.test(out)) {
    console.error(`  FAILED for ${d}: exit ${r.status}, ${tests} tests counted`);
    failed.push(d);
  }
}
if (failed.length) {
  console.error('\nTests failed with today = ' + failed.join(', '));
  process.exit(1);
}
console.log('\nAll dates passed: ' + dates.join(', '));
