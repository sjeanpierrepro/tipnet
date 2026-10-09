// tipnet-v37 (the version live before v38), loaded from git for the update tests: its own storage.js and math.js and
// the modules they import, written to a temp folder and imported. CI checks out the full history; without git or the
// commit, loadV37() gives null and the tests that need it skip (which run-dates counts as a failure).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const V37 = '1090d93';

async function load() {
  const files = new Map();
  try {
    const want = ['storage.js', 'math.js'];
    while (want.length) {
      const f = want.shift();
      if (files.has(f)) continue;
      const src = execFileSync('git', ['show', V37 + ':app/js/' + f], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      files.set(f, src);
      for (const m of src.matchAll(/from '\.\/([\w-]+\.js)'/g)) want.push(m[1]);
    }
  } catch (e) {
    return null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tipnet-v37-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type": "module"}');
    files.forEach((src, f) => fs.writeFileSync(path.join(dir, f), src));
    const storage = await import(pathToFileURL(path.join(dir, 'storage.js')).href);
    const math = await import(pathToFileURL(path.join(dir, 'math.js')).href);
    return { storage, math };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
let loaded = null;
/** {storage, math} of tipnet-v37, or null when git or the commit isn't there. Loaded once. */
export const loadV37 = async () => loaded || (loaded = await load());
