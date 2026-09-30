// Release guard: fails when files under app/ changed but the VERSION line in app/sw.js did not.
// Installed copies of TipNet only fetch new files when that version changes, so forgetting it means
// customers keep running the old app.
//
// Usage: node tools/check-version.mjs <before-commit> <after-commit>
// CI passes github.event.before and github.sha. It skips (exit 0) when <before> is empty or all zeros
// (first push, or a manual workflow run) or is not a commit this checkout knows about (force push).
// Needs the history to be fetched (fetch-depth: 0 in the workflow's checkout step).
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const [before = '', after = 'HEAD'] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

if (!before || /^0+$/.test(before)) {
  console.log('check-version: no earlier commit to compare with (first push or manual run), skipping.');
  process.exit(0);
}
try {
  git('cat-file', '-e', before + '^{commit}');
} catch {
  console.log('check-version: ' + before + ' is not in this checkout (force push?), skipping.');
  process.exit(0);
}

const changed = git('diff', '--name-only', before, after, '--', 'app').split('\n').filter(Boolean);
if (!changed.length) {
  console.log('check-version: nothing under app/ changed, ok.');
  process.exit(0);
}
// Only lines that changed count: the new VERSION line must differ from the old one.
const swDiff = git('diff', '-U0', before, after, '--', 'app/sw.js');
const bumped = swDiff.split('\n').some((l) => /^[+-]\s*const VERSION\s*=/.test(l));
if (bumped) {
  console.log(
    'check-version: VERSION was changed in app/sw.js, ok (' + changed.length + ' app file(s) changed).',
  );
  process.exit(0);
}
console.error(
  'check-version: files under app/ changed but VERSION in app/sw.js did not.\n' +
    "Add 1 to the number in the line  const VERSION = 'tipnet-vNN';  so installed apps fetch the update.\n" +
    'Changed: ' +
    changed.join(', '),
);
process.exit(1);
