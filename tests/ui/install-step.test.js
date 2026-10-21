// The "Put TipNet on your home screen" step of the first guided setup: where it sits on each kind of device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { encodeBackup, decodeBackup, backupFileText, flush } from '../../app/js/storage.js';
import { restoreFromFileText, undoRestore } from '../../app/js/ui/backup.js';
import { setInstallPrompt, restoreRequest } from '../../app/js/ui/common.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36';
const fake = (page, ua, standalone) => {
  if (ua) Object.defineProperty(page.win.navigator, 'userAgent', { configurable: true, value: ua });
  if (standalone !== undefined)
    Object.defineProperty(page.win.navigator, 'standalone', { configurable: true, value: standalone });
};
const tabs = (page) => page.$$('.steps li', page.app).map((li) => li.textContent);
const current = (page) => page.$('.steps [aria-current="step"]', page.app).textContent;
const fillStep0 = (page) => {
  page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
  page.type(page.must(page.$('input[placeholder="e.g. 2,000"]', page.app), 'gross'), '900');
  page.type(page.$('input[placeholder="e.g. 10"]', page.app), '10');
};
/** Steps 1 to 3, up to and including Finish setup. */
async function finishSetup(page) {
  fillStep0(page);
  page.click(page.button('Next'));
  page.click(page.must(page.$('#no-ded'), 'no-ded box'));
  page.click(page.button('Next'));
  page.type(page.must(page.$('input[placeholder="e.g. 12"]', page.app), 'rate'), '8');
  page.click(page.button('Finish setup'));
  await page.settle();
}
const openSetup = async (page) => {
  page.tab('setup');
  await page.settle();
};

test('installed app: no extra step, Three short steps', async () => {
  const page = await boot();
  try {
    fake(page, IPHONE, true);
    await openSetup(page);
    assert.match(page.text(), /Three short steps/);
    assert.equal(tabs(page).length, 3);
    assert.equal(page.byText('button', 'Set up here in Safari instead'), null);
    await finishSetup(page);
    assert.equal(page.state().workplaces[0].setupDone, true);
    assert.equal(page.$('#install-status'), null);
  } finally {
    await page.close();
  }
});

test('iPhone Safari: the step comes first; "Set up here in Safari instead" continues and is remembered', async () => {
  let page = await boot();
  let after;
  try {
    fake(page, IPHONE, false);
    await openSetup(page);
    assert.match(page.text(), /Four short steps/);
    assert.deepEqual(tabs(page), [
      '1. Home screen',
      '2. Pay period and gross',
      '3. Deductions',
      '4. Pay and tip-out',
    ]);
    assert.match(current(page), /^1\./);
    const t = page.text();
    assert.match(t, /Share/);
    assert.match(t, /Add to Home Screen/);
    assert.match(t, /open TipNet from the new icon/i);
    assert.equal(page.byText('button', 'Next'), null, 'the how-to has no Next');
    assert.equal(page.$$('h1', page.app).length, 1);
    page.click(page.button('Set up here in Safari instead'));
    await page.settle();
    assert.equal(page.state().settings.installStepSeen, true);
    assert.match(page.text(), /Three short steps/);
    assert.match(current(page), /^1\. Pay period/);
    assert.equal(page.$('input[type=date]', page.app) !== null, true);
    // Back from step 2 does not bring the step back
    fillStep0(page);
    page.click(page.button('Next'));
    page.click(page.button('Back'));
    assert.match(current(page), /^1\. Pay period/);
    assert.equal(page.byText('button', 'Set up here in Safari instead'), null);
    await flush();
    after = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
  } finally {
    await page.close();
  }
  page = await boot({ seed: after });
  try {
    fake(page, IPHONE, false);
    await openSetup(page);
    assert.match(page.text(), /Three short steps/);
    assert.equal(page.byText('button', 'Set up here in Safari instead'), null);
  } finally {
    await page.close();
  }
});

test('install prompt available: the step comes after step 3 is saved; Install TipNet calls prompt()', async () => {
  const page = await boot();
  try {
    let prompted = 0;
    setInstallPrompt({
      prompt: () => {
        prompted++;
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    await openSetup(page);
    assert.match(page.text(), /Four short steps/);
    assert.deepEqual(tabs(page), [
      '1. Pay period and gross',
      '2. Deductions',
      '3. Pay and tip-out',
      '4. Home screen',
    ]);
    await finishSetup(page);
    const S = page.state();
    assert.equal(S.workplaces[0].setupDone, true, 'saved before the step');
    assert.equal(S.profileExample, false);
    assert.equal(S.workplaces[0].profile.gross, 900);
    assert.match(current(page), /^4\. Home screen/);
    assert.match(page.text(), /Your setup is saved/);
    assert.equal(document.activeElement.tagName, 'H1');
    page.click(page.button('Install TipNet'));
    await page.settle();
    assert.equal(prompted, 1);
    assert.match(page.text(), /Installed\. From now on, open TipNet from your home screen\./);
    assert.equal(page.byText('button', 'Install TipNet'), null);
    page.click(page.button('Done'));
    await page.settle();
    assert.equal(page.state().settings.installStepSeen, true);
    assert.equal(page.$('#install-status'), null, 'back on the app');
    assert.equal(page.state().workplaces[0].setupDone, true);
  } finally {
    await page.close();
  }
});

test('install prompt available: "Not now" finishes; a dismissed prompt changes nothing saved', async () => {
  const page = await boot();
  try {
    let prompted = 0;
    setInstallPrompt({
      prompt: () => {
        prompted++;
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    await openSetup(page);
    await finishSetup(page);
    const before = JSON.stringify(page.state().workplaces);
    page.click(page.button('Install TipNet'));
    await page.settle();
    assert.equal(prompted, 1);
    assert.doesNotMatch(page.text(), /Installed\./);
    assert.equal(JSON.stringify(page.state().workplaces), before);
    // the prompt is used up: only Done is left
    assert.equal(page.byText('button', 'Install TipNet'), null);
    page.click(page.button('Done'));
    await page.settle();
    assert.equal(page.$('#install-now'), null);
  } finally {
    await page.close();
  }
});

test('install prompt available: Not now finishes without prompting', async () => {
  const page = await boot();
  try {
    let prompted = 0;
    setInstallPrompt({ prompt: () => prompted++, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    await openSetup(page);
    await finishSetup(page);
    page.click(page.button('Not now'));
    await page.settle();
    assert.equal(prompted, 0);
    assert.equal(page.state().settings.installStepSeen, true);
    assert.equal(page.byText('button', 'Not now'), null);
    assert.equal(page.state().workplaces[0].setupDone, true);
  } finally {
    await page.close();
  }
});

test('Android without a prompt: the menu steps come last, with Done', async () => {
  const page = await boot();
  try {
    fake(page, ANDROID, undefined);
    await openSetup(page);
    assert.match(page.text(), /Four short steps/);
    await finishSetup(page);
    assert.equal(page.state().workplaces[0].setupDone, true);
    assert.match(current(page), /^4\. Home screen/);
    const t = page.text();
    assert.match(t, /Chrome menu/);
    assert.match(t, /Install app/);
    assert.match(t, /Add to Home screen/);
    assert.equal(page.byText('button', 'Install TipNet'), null);
    page.click(page.button('Done'));
    await page.settle();
    assert.equal(page.byText('button', 'Done'), null);
  } finally {
    await page.close();
  }
});

test('desktop without a prompt: no step', async () => {
  const page = await boot();
  try {
    await openSetup(page);
    assert.match(page.text(), /Three short steps/);
    assert.equal(tabs(page).length, 3);
    await finishSetup(page);
    assert.equal(page.state().workplaces[0].setupDone, true);
    assert.equal(page.$('#install-status'), null);
    assert.equal(page.byText('button', 'Done'), null);
  } finally {
    await page.close();
  }
});

test('adding a second establishment: no step, on any device', async () => {
  for (const [ua, standalone, prompt] of [
    [IPHONE, false, false],
    [ANDROID, undefined, true],
  ]) {
    const page = await boot({
      seed: realState((S) => {
        S.workplaces[0].setupDone = true;
        S.workplaces[0].name = 'Voodoo Bayou';
        S.settings.installStepSeen = false;
      }),
    });
    try {
      fake(page, ua, standalone);
      if (prompt) setInstallPrompt({ prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) });
      page.tab('setup');
      page.click(page.button('+ Set up another establishment'));
      page.type(page.$('#wp-new-name'), 'Second Spot');
      page.click(page.button('Start setup'));
      await page.settle();
      assert.match(page.text(), /Three short steps/);
      assert.equal(tabs(page).length, 3);
      assert.equal(page.byText('button', 'Set up here in Safari instead'), null);
      fillStep0(page);
      page.click(page.button('Next'));
      page.click(page.must(page.$('#no-ded'), 'no-ded box'));
      page.click(page.button('Next'));
      page.type(page.must(page.$('input[placeholder="e.g. 12"]', page.app), 'rate'), '8');
      page.click(page.button('Finish setup'));
      await page.settle();
      assert.equal(page.state().workplaces[1].setupDone, true);
      assert.equal(page.byText('button', 'Not now'), null);
      assert.equal(page.$('#install-status'), null);
    } finally {
      await page.close();
    }
  }
});

test('installStepSeen stays on this device: backups never carry it, and a restore keeps this device’s answer', async () => {
  const S = realState((s) => {
    s.settings.installStepSeen = true;
  });
  assert.equal(decodeBackup(encodeBackup(S)).settings.installStepSeen, undefined);
  assert.equal('installStepSeen' in JSON.parse(backupFileText(S)).settings, false);
  // a hand-made backup that says it was seen: still not taken
  const handMade = JSON.parse(backupFileText(S));
  handMade.settings.installStepSeen = true;
  handMade.profileExample = true; // made before setup was finished
  // a new iPhone in Safari: restoring an old phone's backup (setup not finished) still shows the Safari step
  let page = await boot();
  try {
    fake(page, IPHONE, false);
    restoreFromFileText(JSON.stringify(handMade));
    await page.settle();
    assert.equal(page.state().settings.installStepSeen, undefined);
    await openSetup(page);
    assert.ok(page.byText('button', 'Set up here in Safari instead'), 'the Safari step shows');
  } finally {
    await page.close();
  }
  // this device already answered: a restore (and its Undo) keeps that
  page = await boot({ seed: realState((s) => (s.settings.installStepSeen = true)) });
  try {
    restoreFromFileText(backupFileText(realState()));
    assert.equal(page.state().settings.installStepSeen, true);
    assert.equal(undoRestore(), true);
    assert.equal(page.state().settings.installStepSeen, true);
  } finally {
    await page.close();
  }
});

test('iPhone Safari: while the home-screen step shows, no restore is offered; it comes back after "Set up here"', async () => {
  const page = await boot();
  try {
    fake(page, IPHONE, false);
    await openSetup(page);
    assert.equal(page.$('#restore-link'), null);
    assert.equal(page.byText('button', 'Moving from another phone? Restore a backup code'), null);
    assert.match(
      page.$('#restore-later').textContent,
      /^Moving from another phone\? Add TipNet to your home screen first, then restore your backup there\.$/,
    );
    // a restore asked for elsewhere (the example banner on Tonight) still lands on the step, not on a restore box
    restoreRequest.open = true;
    page.tab('tonight');
    page.tab('setup');
    await page.settle();
    assert.equal(page.$('#bk-code'), null);
    assert.ok(page.byText('button', 'Set up here in Safari instead'));
    assert.equal(restoreRequest.open, false);
    page.click(page.button('Set up here in Safari instead'));
    await page.settle();
    assert.equal(page.$('#restore-later'), null);
    assert.ok(page.$('#restore-link'), 'the restore link is back');
  } finally {
    await page.close();
  }
});

test('not iPhone Safari: the restore link is unchanged', async () => {
  const page = await boot();
  try {
    fake(page, IPHONE, true);
    await openSetup(page);
    assert.ok(page.$('#restore-link'));
    assert.equal(page.$('#restore-later'), null);
  } finally {
    await page.close();
  }
});
