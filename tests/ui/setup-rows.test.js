// Setup after setup is done (owner request): each restaurant is one row; opening it edits a draft that Save applies all
// at once (Cancel discards); leaving with unsaved changes asks first; shared sections are rows that apply right away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import * as storage from '../../app/js/storage.js';

const one = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const two = (mutate) =>
  one((S) => {
    const w2 = JSON.parse(JSON.stringify(S.workplaces[0]));
    w2.id = 'w2';
    w2.name = 'Second Spot';
    w2.profile.payTypes[0].rate = 15;
    w2.profile.payDelay = 6;
    S.workplaces.push(w2);
    if (mutate) mutate(S);
  });
const gross = (page) =>
  page.must(page.byText('.field', 'Gross pay', page.app), 'gross').querySelector('input');
const row = (page, id) => page.must(page.$('#wp-row-' + id), 'row ' + id);
const expanded = (page, id) => row(page, id).getAttribute('aria-expanded') === 'true';
const selected = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;
const setGross = (page, v) => {
  const g = gross(page);
  page.type(g, v);
  page.change(g);
};

test('setup rows: after setup each restaurant is one closed row with a summary; shared sections are rows too', async () => {
  const page = await boot({ seed: two() });
  try {
    page.tab('setup');
    assert.equal(expanded(page, 'w1'), false);
    assert.equal(expanded(page, 'w2'), false);
    assert.equal(page.$('#wp-name'), null, 'no editable cards until a row is opened');
    assert.equal(page.$('#draft-save'), null);
    const sum = (id) => page.text(row(page, id).querySelector('.fold-sum'));
    assert.equal(sum('w1'), 'Bartender $12/h · every two weeks');
    assert.match(sum('w2'), /^Bartender \$15\/h · every two weeks · payday (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    assert.equal(row(page, 'w1').closest('h2').tagName, 'H2', 'each row is a heading with a button');
    for (const k of ['cutoff', 'theme', 'import', 'install', 'backup', 'privacy']) {
      const b = page.must(page.$('#fold-' + k), 'shared row ' + k);
      assert.equal(b.getAttribute('aria-expanded'), 'false', k);
      assert.equal(page.$('#fold-body-' + k).hidden, true, k);
    }
    assert.match(page.text(), /Changes apply right away/);
    assert.ok(page.$('#wp-add'), '+ Set up another restaurant stays visible');
    assert.equal(page.app.lastElementChild.id, 'budget-teaser', 'the Budget card is at the very bottom');
    // Enter/Space work because the row is a real button
    assert.equal(row(page, 'w1').tagName, 'BUTTON');
    assert.equal(row(page, 'w1').getAttribute('type'), 'button');
  } finally {
    await page.close();
  }
});

test('setup rows: open, edit, Save applies everything at once, closes the row and returns focus to it', async () => {
  const page = await boot({ seed: one((S) => (S.workplaces[0].profile.rateOverride = 0.2)) });
  try {
    page.tab('setup');
    page.click(row(page, 'w1'));
    assert.equal(expanded(page, 'w1'), true);
    assert.equal(page.doc.activeElement, row(page, 'w1'));
    assert.ok(page.$('#wp-body-w1'));
    assert.equal(row(page, 'w1').getAttribute('aria-controls'), 'wp-body-w1');
    assert.match(page.$('#draft-state').textContent, /No changes yet/);
    setGross(page, '2500');
    page.type(page.$('#pr-p1'), '13');
    const cb = page.$('#cash-off-payroll');
    cb.checked = true;
    page.change(cb);
    assert.match(page.$('#draft-state').textContent, /changes that aren’t saved yet/);
    let p = page.state().workplaces[0].profile;
    assert.deepEqual([p.gross, p.payTypes[0].rate, p.cashOffPayroll], [2000, 12, false], 'nothing saved yet');
    assert.match(page.text(), /saving clears TipNet’s accuracy adjustment/);
    await page.saveSetup();
    p = page.state().workplaces[0].profile;
    assert.deepEqual([p.gross, p.payTypes[0].rate, p.cashOffPayroll], [2500, 13, true], 'all applied');
    assert.equal(p.rateOverride, null, 'gross changed: the accuracy adjustment is cleared');
    assert.equal(expanded(page, 'w1'), false, 'closed again');
    assert.equal(page.doc.activeElement, row(page, 'w1'), 'focus back on the row');
    assert.match(page.$('#wp-saved-w1').textContent, /^Saved\./);
    assert.match(page.text(row(page, 'w1')), /\$13\/h/);
    // and it is on disk
    await storage.flush();
    assert.equal(JSON.parse(page.win.localStorage.getItem('tipnet.v2')).workplaces[0].profile.gross, 2500);
  } finally {
    await page.close();
  }
});

test('setup rows: Cancel discards the draft and closes the row', async () => {
  const page = await boot({ seed: one() });
  try {
    page.openSetup();
    setGross(page, '9999');
    page.click(page.$('#draft-cancel'));
    assert.equal(page.state().workplaces[0].profile.gross, 2000);
    assert.equal(expanded(page, 'w1'), false);
    assert.equal(page.doc.activeElement, row(page, 'w1'));
    page.openSetup();
    assert.equal(gross(page).value, '2000', 'opening again shows what is saved');
  } finally {
    await page.close();
  }
});

test('setup rows: switching tabs with unsaved changes asks Save / Discard / Keep editing', async () => {
  const page = await boot({ seed: one() });
  try {
    page.openSetup();
    setGross(page, '2600');
    page.tab('periods');
    assert.equal(selected(page), 'setup', 'still on Setup');
    assert.match(page.text(page.$('#draft-bar')), /Save changes to My restaurant\?/);
    assert.equal(page.$('#draft-bar').getAttribute('role'), 'group');
    assert.equal(page.doc.activeElement, page.$('#draft-ask-save'));
    page.click(page.$('#draft-ask-keep'));
    assert.equal(selected(page), 'setup');
    assert.equal(gross(page).value, '2600', 'Keep editing keeps the draft');
    assert.equal(page.doc.activeElement, page.$('#draft-save'));
    page.tab('periods');
    page.click(page.$('#draft-ask-discard'));
    assert.equal(selected(page), 'periods');
    assert.equal(page.state().workplaces[0].profile.gross, 2000, 'discarded');
    // nothing typed: no question
    page.openSetup();
    page.tab('tonight');
    assert.equal(selected(page), 'tonight');
    // the Budget card's "See what's inside" goes through the same question
    page.openSetup();
    setGross(page, '2700');
    page.click(page.button('See what’s inside', page.$('#budget-teaser')));
    assert.equal(selected(page), 'setup');
    page.click(page.$('#draft-ask-save'));
    await page.settle();
    assert.equal(page.state().workplaces[0].profile.gross, 2700, 'saved');
    assert.equal(selected(page), 'budget', 'then carried on');
  } finally {
    await page.close();
  }
});

test('setup rows: opening another restaurant with unsaved changes asks first; only one is open at a time', async () => {
  const page = await boot({ seed: two() });
  try {
    page.openSetup('My restaurant');
    page.click(row(page, 'w2'));
    assert.equal(expanded(page, 'w2'), true, 'nothing typed: it simply switches');
    assert.equal(expanded(page, 'w1'), false);
    setGross(page, '3100');
    page.click(row(page, 'w1'));
    assert.match(page.text(), /Save changes to Second Spot\?/);
    assert.equal(expanded(page, 'w2'), true);
    page.click(page.$('#draft-ask-save'));
    await page.settle();
    assert.equal(page.state().workplaces[1].profile.gross, 3100);
    assert.equal(page.state().workplaces[0].profile.gross, 2000);
    assert.equal(expanded(page, 'w1'), true, 'then the other one opens');
    assert.equal(expanded(page, 'w2'), false);
    assert.equal(page.$$('.fold-open [id^="wp-body-"]').length, 1);
    // closing the open row by its heading also asks when something is unsaved
    setGross(page, '2200');
    page.click(row(page, 'w1'));
    assert.match(page.text(), /Save changes to My restaurant\?/);
    page.click(page.$('#draft-ask-discard'));
    assert.equal(expanded(page, 'w1'), false);
    assert.equal(page.state().workplaces[0].profile.gross, 2000);
  } finally {
    await page.close();
  }
});

test('setup rows: Save is disabled with plain reasons while the basics are missing or wrong', async () => {
  const page = await boot({ seed: one() });
  try {
    page.openSetup();
    setGross(page, '');
    const save = page.$('#draft-save');
    assert.equal(save.disabled, true);
    assert.match(page.$('#draft-reasons').textContent, /To save: Enter your gross pay\./);
    assert.equal(save.getAttribute('aria-describedby'), 'draft-reasons');
    page.type(page.$('#pr-p1'), '0');
    assert.match(page.$('#draft-reasons').textContent, /Enter your main job’s rate\./);
    page.type(page.$('#wp-name'), '');
    assert.match(page.$('#draft-reasons').textContent, /Give the restaurant a name\./);
    page.click(save);
    assert.equal(expanded(page, 'w1'), true, 'nothing saved, still open');
    page.type(page.$('#wp-name'), 'Voodoo Bayou');
    page.type(page.$('#pr-p1'), '12');
    setGross(page, '2000');
    assert.equal(save.disabled, false);
    assert.equal(page.$('#draft-reasons').hidden, true);
    const to = page.$('#to-on');
    to.checked = true;
    page.change(to);
    if (!page.$('#draft-save').disabled) {
      // the example tip-out keeps its amount; clear it to see the reason
      const amt = page.byText('.field', 'Percent of tips', page.app).querySelector('input');
      page.type(amt, '');
    }
    assert.equal(page.$('#draft-save').disabled, true);
    assert.match(page.$('#draft-reasons').textContent, /Enter the tip-out amount, or turn tip-outs off\./);
  } finally {
    await page.close();
  }
});

test('setup rows: another window saving keeps the unsaved draft; Save then keeps both', async () => {
  const page = await boot({ seed: one() });
  try {
    page.openSetup();
    setGross(page, '2800');
    const theirs = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
    theirs.settings.theme = 'dark';
    theirs._savedAt = Date.now() + 5000;
    theirs._writer = 'window-B';
    page.win.localStorage.setItem('tipnet.v2', JSON.stringify(theirs));
    await storage.syncFromStorage();
    await page.settle();
    assert.equal(page.state().settings.theme, 'dark', 'their change is in');
    assert.equal(expanded(page, 'w1'), true, 'still open');
    assert.equal(gross(page).value, '2800', 'the draft survived the merge and redraw');
    assert.match(page.$('#draft-state').textContent, /changes that aren’t saved yet/);
    page.click(row(page, 'w1')); // a redraw by the screen itself keeps it too
    page.click(page.$('#draft-ask-keep'));
    assert.equal(gross(page).value, '2800');
    await page.saveSetup();
    await storage.flush();
    const disk = JSON.parse(page.win.localStorage.getItem('tipnet.v2'));
    assert.equal(disk.workplaces[0].profile.gross, 2800);
    assert.equal(disk.settings.theme, 'dark');
  } finally {
    await page.close();
  }
});

test('setup rows: shared sections open in place and apply right away, without Save', async () => {
  const page = await boot({ seed: one() });
  try {
    page.tab('setup');
    const head = page.$('#fold-theme');
    page.click(head);
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.equal(page.$('#fold-body-theme').hidden, false);
    page.click(page.button('Dark', page.$('#fold-body-theme')));
    assert.equal(page.state().settings.theme, 'dark', 'applied at once');
    assert.equal(page.text(head.querySelector('.fold-sum')), 'Dark');
    assert.equal(page.$('#draft-save'), null, 'no Save for shared settings');
    page.click(head);
    assert.equal(page.$('#fold-body-theme').hidden, true);
    // the backup row still reaches the restore box
    page.click(page.$('#fold-backup'));
    assert.ok(page.$('#bk-code'));
    assert.match(page.text(page.$('#fold-backup')), /Last backup: never/);
  } finally {
    await page.close();
  }
});

test('setup rows: closing or reloading asks only while something is unsaved', async () => {
  const page = await boot({ seed: one() });
  try {
    const leave = () => {
      const e = new page.win.Event('beforeunload', { cancelable: true });
      page.win.dispatchEvent(e);
      return e.defaultPrevented;
    };
    page.openSetup();
    assert.equal(leave(), false, 'nothing typed');
    setGross(page, '2100');
    assert.equal(leave(), true, 'unsaved changes');
    await page.saveSetup();
    assert.equal(leave(), false, 'saved');
  } finally {
    await page.close();
  }
});
