// Runs the whole test suite as if today were each of a few awkward dates, so no test depends on the real calendar.
// Usage: npm run test:dates   (or: node tools/test-dates.mjs 2026-10-05 2027-01-01)
// Each run sets TIPNET_FAKE_TODAY and preloads tools/fake-today.mjs into every test process via NODE_OPTIONS.
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

let failed = [];
for (const d of dates) {
  console.log(`\n=== node --test with today = ${d} ===`);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=dot'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      TIPNET_FAKE_TODAY: d,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' '),
    },
  });
  if (r.status !== 0) failed.push(d);
}
if (failed.length) {
  console.error('\nTests failed with today = ' + failed.join(', '));
  process.exit(1);
}
console.log('\nAll dates passed: ' + dates.join(', '));
