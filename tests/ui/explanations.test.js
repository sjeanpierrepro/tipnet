// Setup > Explanations (Show / Hide): how-it-works text gives way to a small "ⓘ" button; errors, warnings, money and
// live results never hide. The harness loads no stylesheet, so the real components.css is injected into the page and
// the computed display of each node (and its parents) decides what is "shown".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, realState, APP_DIR } from './harness.js';
import { encodeBackup, decodeBackup } from '../../app/js/storage.js';
import { fileSaver, restoreFromCode } from '../../app/js/ui/backup.js';
import { exampleNights } from '../../app/js/math.js';
import { businessDate } from '../../app/js/inputs.js';

fileSaver.save = () => {};
const CSS = readFileSync(APP_DIR + '/css/components.css', 'utf8');

const withNights = (count, f) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.settings.lastBackupAt = Date.now() - 3600e3; // the 30-day backup reminder is not due
    S.nights = exampleNights(businessDate()).slice(0, count);
    while (S.nights.length < count)
      S.nights.push({ ...S.nights[0], id: 'x' + S.nights.length, date: '2026-01-' + (10 + S.nights.length) });
    S.nights.forEach((n) => (n.workplaceId = S.workplaces[0].id));
    if (f) f(S);
  });
const withCss = (page) => {
  const st = page.doc.createElement('style');
  st.textContent = CSS;
  page.doc.head.append(st);
  return page;
};
/** Really on screen: no node from it up to the page is display:none or [hidden]. */
const shown = (page, n) => {
  for (let e = n; e && e !== page.doc.documentElement; e = e.parentElement)
    if (e.hidden || page.win.getComputedStyle(e).display === 'none') return false;
  return true;
};
/** The explanations on the page, leaving out those in a Setup row that is folded shut. */
const live = (page) => page.$$('[data-explain]').filter((h) => !h.closest('.fold-body[hidden]'));
const hintOf = (page, re) =>
  page.must(
    page.$$('[data-explain]').find((n) => re.test(n.textContent)),
    String(re),
  );
const setExplanations = (page, v) => {
  page.tab('setup');
  const head = page.$('#fold-explain');
  if (head.getAttribute('aria-expanded') !== 'true') page.click(head);
  page.click(page.button(v === 'hide' ? 'Hide' : 'Show', page.$('#fold-body-explain')));
};

test('the setting is a Show / Hide row in Setup, applies at once, persists and is in a backup', async () => {
  const page = withCss(await boot({ seed: withNights(2) }));
  try {
    assert.equal(page.doc.documentElement.getAttribute('data-explanations'), null, 'default: show');
    page.tab('setup');
    assert.match(page.$('#fold-explain').textContent, /Explanations,? Shown/);
    setExplanations(page, 'hide');
    assert.equal(page.state().settings.explanations, 'hide');
    assert.equal(page.doc.documentElement.getAttribute('data-explanations'), 'hide');
    assert.match(page.$('#fold-explain').textContent, /Hidden/);
    // in a backup, and back from it
    const code = encodeBackup(page.state());
    assert.equal(decodeBackup(code).settings.explanations, 'hide');
    setExplanations(page, 'show');
    assert.equal(page.state().settings.explanations, undefined, 'absent means show');
    assert.equal(page.doc.documentElement.getAttribute('data-explanations'), null);
    restoreFromCode(code);
    page.tab('tonight');
    assert.equal(page.state().settings.explanations, 'hide');
    assert.equal(page.doc.documentElement.getAttribute('data-explanations'), 'hide', 'a restore applies it');
  } finally {
    await page.close();
  }
});

test('a saved "hide" is kept on load and drives the page from the first draw', async () => {
  const page = withCss(await boot({ seed: withNights(2, (S) => (S.settings.explanations = 'hide')) }));
  try {
    assert.equal(page.doc.documentElement.getAttribute('data-explanations'), 'hide');
    assert.equal(page.state().settings.explanations, 'hide');
  } finally {
    await page.close();
  }
});

test('hidden: hint paragraphs go and leave an ⓘ button that reveals just that one; Show restores them all', async () => {
  const page = withCss(await boot({ seed: withNights(2) }));
  try {
    page.openSetup();
    const hints = live(page);
    assert.ok(hints.length >= 5, 'the Setup screen has explanations: ' + hints.length);
    assert.ok(
      hints.every((h) => shown(page, h)),
      'shown by default',
    );
    assert.ok(
      page.$$('.explain-btn').every((b) => !shown(page, b)),
      'no ⓘ while shown',
    );
    setExplanations(page, 'hide');
    page.openSetup();
    const now = page.$$('[data-explain]'); // all of them, folded rows too
    assert.ok(now.length >= 5);
    assert.ok(
      now.every((h) => !shown(page, h)),
      'every explanation is hidden',
    );
    const btns = page.$$('.explain-btn');
    assert.equal(btns.length, now.length, 'one ⓘ for each');
    btns.forEach((b) => {
      assert.equal(b.textContent, 'ⓘ');
      assert.match(b.getAttribute('aria-label'), /^Show explanation(: .+)?$/);
      assert.equal(b.getAttribute('aria-expanded'), 'false');
      assert.equal(b.getAttribute('type'), 'button');
      assert.ok(b.closest('.fold-body[hidden]') || shown(page, b));
    });
    // the field hint under the shift count (a field(..., { hint }) hint)
    const gross = hintOf(page, /How many shifts you usually work/);
    const btn = gross.parentElement.querySelector('.explain-btn');
    // a field's ⓘ is named after that field, so each one is told apart
    assert.equal(btn.getAttribute('aria-label'), 'Show explanation: Shifts you work in a pay period');
    const named = btns.map((b) => b.getAttribute('aria-label')).filter((n) => n !== 'Show explanation');
    assert.ok(named.length >= 3, 'field ⓘ buttons carry their field name: ' + named.length);
    page.click(btn);
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.ok(shown(page, gross), 'revealed');
    assert.equal(live(page).filter((h) => shown(page, h)).length, 1, 'only that one');
    page.click(btn);
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.ok(!shown(page, gross), 'tapped again: hidden again');
    // a redraw closes it too
    page.click(btn);
    page.tab('tonight');
    page.openSetup();
    assert.equal(live(page).filter((h) => shown(page, h)).length, 0);
    // back to Show
    setExplanations(page, 'show');
    assert.ok(live(page).every((h) => shown(page, h)));
    assert.ok(page.$$('.explain-btn').every((b) => !shown(page, b)));
  } finally {
    await page.close();
  }
});

test('hidden: errors, warnings, notes that need action and money stay on screen', async () => {
  const seed = withNights(5, (S) => {
    S.settings.explanations = 'hide';
    delete S.settings.lastBackupAt; // 5+ real nights and no backup: the reminder is due
  });
  const page = withCss(await boot({ seed }));
  try {
    // the backup reminder on Tonight, and the update bar
    const nudge = page.must(page.$('#backup-nudge'), 'backup reminder');
    assert.ok(shown(page, nudge));
    assert.equal(nudge.closest('[data-explain]'), null);
    assert.equal(nudge.querySelector('[data-explain]'), null);
    const bar = page.doc.getElementById('update-bar');
    bar.hidden = false;
    page.tab('tonight');
    assert.ok(shown(page, bar), 'update bar');
    assert.equal(bar.closest('[data-explain]'), null);
    // Tonight: the take-home (money) and its notes
    page.type(page.$('[data-focus-key="night-cc"]'), '228');
    page.type(page.$('[data-focus-key="night-pay-p1"]'), '6');
    const result = page.must(page.$('.result'), 'result');
    assert.ok(shown(page, result));
    assert.match(page.text(result), /\$/);
    assert.equal(result.querySelector('.hero').closest('[data-explain]'), null);
    page.$$('.result .note').forEach((n) => assert.ok(shown(page, n), 'result note: ' + n.textContent));
    assert.equal(
      page.$$('.result [data-explain]').length,
      0,
      'nothing in the result hides (tax caveats included)',
    );
    // money caveats never hide: the one-rate line, and the hint under Gross pay
    assert.ok(shown(page, page.must(page.$('#result-one-rate'), 'one-rate line')));
    // money-entry instructions never hide: with tip-outs set, the tips are entered before tipping out
    [
      /Credit card tips, before tip-outs\./,
      /All your cash tips, before paying/,
      /Tips only: TipNet adds the pay/,
    ].forEach((re) => {
      const n = page.must(
        page.$$('p.hint', page.app).find((p) => re.test(p.textContent)),
        String(re),
      );
      assert.ok(shown(page, n), 'Tonight: ' + re);
      assert.equal(n.closest('[data-explain]'), null, 'not an explanation: ' + re);
    });
    // Setup: the low-gross note and the capped-rate warning
    page.openSetup();
    const gross = page.byText('.field', 'Gross pay', page.app).querySelector('input');
    page.type(gross, '2');
    page.change(gross);
    const low = page.must(page.$('#gross-check'), 'low-gross note');
    assert.match(low.textContent, /small gross pay/);
    assert.equal(low.hidden, false);
    assert.ok(shown(page, low));
    assert.equal(low.closest('[data-explain]'), null);
    const rate = page.must(page.$('#rate-check'), 'rate check');
    assert.match(rate.textContent, /100%/);
    assert.ok(shown(page, rate));
    const grossHint = page.byText('p.hint', 'top-line gross pay figure', page.app);
    assert.ok(grossHint && shown(page, grossHint), 'the Gross pay caveat');
    assert.equal(grossHint.closest('[data-explain]'), null);
    // Setup's money-entry instructions: per pay period, not year-to-date; tips are entered before tipping out
    [
      /not year-to-date/,
      /dollar amount for that pay period/,
      /On Tonight you enter your tips before tipping out/,
    ].forEach((re) => {
      const n = page.must(
        page.$$('p', page.app).find((p) => re.test(p.textContent)),
        String(re),
      );
      assert.equal(n.closest('[data-explain]'), null, 'not an explanation: ' + re);
      assert.ok(n.closest('.fold-body[hidden]') || shown(page, n), 'Setup: ' + re);
    });
    // no error, warning or live region sits inside an explanation, anywhere on the page
    const bad = page.$$(
      '[data-explain] .field-error, [data-explain] [role=alert], [data-explain] [role=status], [data-explain] [aria-live], .field-error[data-explain], [role=status][data-explain], [aria-live][data-explain]',
    );
    assert.equal(bad.length, 0);
    // the privacy links
    page.click(page.$('#fold-privacy'));
    const links = page.$$('a[href="privacy.html"], a[href="terms.html"]', page.app);
    assert.equal(links.length, 2);
    links.forEach((a) => assert.ok(shown(page, a)));
  } finally {
    await page.close();
  }
});

test('hidden: the payday-required error in guided setup still shows', async () => {
  const page = withCss(await boot());
  try {
    page.state().settings.explanations = 'hide';
    page.tab('tonight'); // redraw: the setting applies
    page.tab('setup');
    page.type(page.$$('input[type=date]', page.app)[0], '2026-09-01');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '1500');
    page.type(page.$('input[placeholder="e.g. 10"]', page.app), '10');
    page.click(page.button('Next'));
    const msg = page.byText('.field-error', 'payday', page.app);
    assert.ok(msg, 'the payday error is on the page');
    assert.ok(shown(page, msg));
    assert.equal(msg.closest('[data-explain]'), null);
    // its hint is the explanation that hides, the error is not
    assert.ok(!shown(page, hintOf(page, /pay date printed on your paystub/)));
  } finally {
    delete page.state().settings.explanations; // the first-run state object is shared with later boots
    await page.close();
  }
});

test('Tonight asks once, at 10 real nights, and never beside a backup card', async () => {
  // 9 nights: no card
  let page = await boot({ seed: withNights(9) });
  try {
    assert.equal(page.$('#explain-prompt'), null);
  } finally {
    await page.close();
  }
  // example nights never count
  page = await boot({ seed: withNights(12, (S) => (S.nightsExample = true)) });
  try {
    assert.equal(page.$('#explain-prompt'), null);
  } finally {
    await page.close();
  }
  // 10 real nights: the card, only on Tonight
  page = await boot({ seed: withNights(10) });
  try {
    const card = page.must(page.$('#explain-prompt'), 'card');
    assert.match(
      page.text(card),
      /Getting the hang of it\? Hide the explanations to keep screens short\. You can turn them back on in Setup\./,
    );
    assert.deepEqual(
      page.$$('button', card).map((b) => b.textContent),
      ['Hide explanations', 'Not now'],
    );
    page.tab('periods');
    assert.equal(page.$('#explain-prompt'), null);
    page.tab('setup');
    assert.equal(page.$('#explain-prompt'), null);
    // Not now: recorded, gone for good, explanations stay
    page.tab('tonight');
    page.click(page.button('Not now', page.$('#explain-prompt')));
    assert.equal(page.state().settings.explainPromptSeen, true);
    assert.equal(page.state().settings.explanations, undefined);
    assert.equal(page.$('#explain-prompt'), null);
    page.tab('periods');
    page.tab('tonight');
    assert.equal(page.$('#explain-prompt'), null);
  } finally {
    await page.close();
  }
  // Hide explanations: hides them and records the choice
  page = await boot({ seed: withNights(11) });
  try {
    page.click(page.button('Hide explanations'));
    assert.equal(page.state().settings.explainPromptSeen, true);
    assert.equal(page.state().settings.explanations, 'hide');
    assert.equal(page.doc.documentElement.getAttribute('data-explanations'), 'hide');
    assert.equal(page.$('#explain-prompt'), null);
    // the choice is in a backup (like the iPhone note)
    assert.equal(decodeBackup(encodeBackup(page.state())).settings.explainPromptSeen, true);
  } finally {
    await page.close();
  }
  // choosing in Setup counts as answering
  page = await boot({ seed: withNights(10) });
  try {
    setExplanations(page, 'hide');
    setExplanations(page, 'show');
    page.tab('tonight');
    assert.equal(page.$('#explain-prompt'), null);
  } finally {
    await page.close();
  }
});

test('the backup card wins: no explanations card beside it, it waits its turn', async () => {
  const page = await boot({ seed: withNights(10, (S) => (S.settings.nightsSinceBackup = 10)) });
  try {
    assert.ok(page.$('#nights-backup'), 'backup card');
    assert.equal(page.$('#explain-prompt'), null, 'not at the same time');
    page.click(page.button('Not now', page.$('#nights-backup')));
    assert.equal(page.$('#nights-backup'), null);
    assert.ok(page.$('#explain-prompt'), 'then the explanations card');
  } finally {
    await page.close();
  }
  // the 30-day reminder is a backup card too
  const p2 = await boot({ seed: withNights(10, (S) => delete S.settings.lastBackupAt) });
  try {
    assert.ok(p2.$('#backup-nudge'));
    assert.equal(p2.$('#explain-prompt'), null);
  } finally {
    await p2.close();
  }
});
