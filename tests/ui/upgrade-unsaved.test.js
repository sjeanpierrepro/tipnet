// "Upgrade" on the TipNet Budget card with unsaved Setup changes: the Save-changes question gets the focus, and after
// Save or Discard the app lands on the "Unlock Budget" card. Keep editing stays in Setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';

const setUp = () => realState((S) => (S.workplaces[0].setupDone = true));
const selected = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;

async function dirtySetup() {
  const page = await boot({ seed: setUp() });
  page.tab('setup');
  page.click(page.$('#wp-row-w1'));
  const rate = page.must(page.$('#pr-p1'), 'main rate');
  page.type(rate, '13.5');
  page.change(rate);
  return page;
}

test('Upgrade with unsaved Setup changes: the question has the focus, Keep editing stays, Save/Discard land on Unlock Budget', async () => {
  for (const choice of ['draft-ask-keep', 'draft-ask-discard', 'draft-ask-save']) {
    const page = await dirtySetup();
    try {
      page.click(page.button('Upgrade', page.$('#budget-teaser')));
      assert.match(page.text(), /Save changes to/, choice + ': asks first');
      assert.equal(selected(page), 'setup', choice + ': still in Setup while it asks');
      assert.equal(page.doc.activeElement, page.$('#draft-ask-save'), choice + ': focus is on the question');
      page.click(page.$('#' + choice));
      await page.settle();
      if (choice === 'draft-ask-keep') {
        assert.equal(selected(page), 'setup', 'Keep editing stays in Setup');
        continue;
      }
      assert.equal(selected(page), 'budget');
      assert.equal(page.doc.activeElement, page.$('#budget-upgrade-h'), choice + ': lands on Unlock Budget');
    } finally {
      await page.close();
    }
  }
});

test('Upgrade with nothing unsaved still goes straight to Unlock Budget', async () => {
  const page = await boot({ seed: setUp() });
  try {
    page.tab('setup');
    page.click(page.button('Upgrade', page.$('#budget-teaser')));
    assert.equal(selected(page), 'budget');
    assert.equal(page.doc.activeElement, page.$('#budget-upgrade-h'));
  } finally {
    await page.close();
  }
});
