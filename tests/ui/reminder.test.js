// Setup > Nightly reminder: saves a calendar file (.ics) through the same fileSaver as backup files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { fileSaver } from '../../app/js/ui/backup.js';

const saved = [];
fileSaver.save = (name, text, type) => saved.push({ name, text, type });

test('Nightly reminder: row, defaults, refuses no days, saves the .ics and the setting', async () => {
  saved.length = 0;
  const page = await boot({ seed: realState() });
  try {
    page.tab('setup');
    const head = page.must(page.$('#fold-reminder'), 'reminder row');
    assert.match(head.textContent, /Nightly reminder/);
    assert.match(head.textContent, /Not added yet/);
    page.click(head);
    assert.equal(page.$('#rem-time').value, '02:00');
    assert.equal(page.$('#rem-time').type, 'time');
    for (let i = 0; i < 7; i++) assert.equal(page.$('#rem-day-' + i).checked, true);
    assert.match(page.text(), /Your phone's calendar will remind you at this time/);

    // no days: a plain message, nothing saved
    for (let i = 0; i < 7; i++) {
      page.$('#rem-day-' + i).checked = false;
      page.change(page.$('#rem-day-' + i));
    }
    page.click(page.button('Add to my calendar'));
    assert.equal(saved.length, 0);
    assert.equal(page.$('#rem-err').hidden, false);
    assert.match(page.$('#rem-err').textContent, /at least one day/);
    assert.equal(page.state().settings.reminder, undefined);

    // Mon-Sat at 1:30 AM
    for (let i = 0; i < 6; i++) {
      page.$('#rem-day-' + i).checked = true;
      page.change(page.$('#rem-day-' + i));
    }
    page.$('#rem-time').value = '01:30';
    page.change(page.$('#rem-time'));
    page.click(page.button('Add to my calendar'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'tipnet-reminder.ics');
    assert.equal(saved[0].type, 'text/calendar;charset=utf-8');
    assert.match(saved[0].text, /^BEGIN:VCALENDAR\r\n/);
    // Mon-Sat NIGHTS at 1:30 AM (before noon): Tuesday to Sunday mornings
    assert.match(saved[0].text, /RRULE:FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA,SU\r\n/);
    assert.match(saved[0].text, /DTSTART:\d{8}T013000\r\n/);
    assert.match(saved[0].text, /SEQUENCE:0\r\n/);
    const r = page.state().settings.reminder;
    assert.equal(r.time, '01:30');
    assert.deepEqual(r.days, [0, 1, 2, 3, 4, 5]);
    assert.match(r.uid, /^tipnet-reminder-[a-z0-9]+@tipnet$/);
    assert.equal(page.$('#rem-err').hidden, true);
    assert.match(page.$('#rem-last').textContent, /^Added: 1:30 AM, Mon–Sat nights$/);
    assert.match(page.$('#fold-reminder').textContent, /Added: 1:30 AM, Mon–Sat nights/);

    // adding again keeps the UID and raises SEQUENCE
    page.click(page.button('Add to my calendar'));
    assert.equal(saved.length, 2);
    assert.match(saved[1].text, /SEQUENCE:1\r\n/);
    assert.equal(page.state().settings.reminder.uid, r.uid);
    assert.ok(saved[1].text.includes('UID:' + r.uid));
  } finally {
    await page.close();
  }
});

test('Nightly reminder: the boxes are the nights you work; Fri and Sat at 2:00 AM remind Saturday and Sunday mornings', async () => {
  saved.length = 0;
  const page = await boot({ seed: realState() });
  try {
    page.tab('setup');
    page.click(page.must(page.$('#fold-reminder'), 'reminder row'));
    const group = page.must(page.$('[role=group][aria-labelledby="rem-days-label"]'), 'nights group');
    assert.equal(page.$('#rem-days-label').textContent, 'Nights you work');
    assert.ok(group.contains(page.$('#rem-day-4')));
    assert.equal(
      page.$('#rem-early').textContent,
      'Times before noon remind you the morning after each night you work.',
    );
    for (let i = 0; i < 7; i++) {
      page.$('#rem-day-' + i).checked = i === 4 || i === 5;
      page.change(page.$('#rem-day-' + i));
    }
    page.click(page.button('Add to my calendar'));
    assert.match(saved[0].text, /RRULE:FREQ=WEEKLY;BYDAY=SA,SU\r\n/);
    assert.deepEqual(page.state().settings.reminder.days, [4, 5], 'the nights ticked are kept');
    assert.match(page.$('#rem-last').textContent, /^Added: 2:00 AM, Fri, Sat nights$/);
    // 10:00 PM comes on the night itself
    page.$('#rem-time').value = '22:00';
    page.change(page.$('#rem-time'));
    assert.equal(page.$('#rem-early').hidden, true);
    page.click(page.button('Add to my calendar'));
    assert.match(saved[1].text, /RRULE:FREQ=WEEKLY;BYDAY=FR,SA\r\n/);
  } finally {
    await page.close();
  }
});

// Sixth review: the day only moved when the time was before the Late-nights cutoff, so 2:00 AM with Late nights off,
// or 9:00 AM, reminded after Thursday and Friday nights (none after Saturday's). Before noon is now the morning after.
for (const [cutoff, time, want, hint] of [
  [0, '02:00', 'SA,SU', true],
  [6, '09:00', 'SA,SU', true],
  [3, '04:00', 'SA,SU', true],
  [6, '23:00', 'FR,SA', false],
  [0, '12:00', 'FR,SA', false],
]) {
  test(
    'Nightly reminder: Fri and Sat nights at ' + time + ' (Late nights ' + cutoff + ') remind ' + want,
    async () => {
      saved.length = 0;
      const page = await boot({ seed: realState((S) => (S.settings.dayCutoffHour = cutoff)) });
      try {
        page.tab('setup');
        page.click(page.must(page.$('#fold-reminder'), 'reminder row'));
        for (let i = 0; i < 7; i++) {
          page.$('#rem-day-' + i).checked = i === 4 || i === 5;
          page.change(page.$('#rem-day-' + i));
        }
        page.$('#rem-time').value = time;
        page.change(page.$('#rem-time'));
        assert.equal(page.$('#rem-early').hidden, !hint);
        if (hint)
          assert.equal(
            page.$('#rem-early').textContent,
            'Times before noon remind you the morning after each night you work.',
          );
        page.click(page.button('Add to my calendar'));
        assert.match(saved[0].text, new RegExp('RRULE:FREQ=WEEKLY;BYDAY=' + want + '\r\n'));
      } finally {
        await page.close();
      }
    },
  );
}
