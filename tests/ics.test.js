// The nightly reminder .ics builder (pure) and the saved-reminder settings check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIcs,
  nextStart,
  floating,
  escapeText,
  fold,
  makeUid,
  timeLabel,
  daysLabel,
  nightsLabel,
  reminderDays,
  cleanDays,
} from '../app/js/ics.js';
import { migrate, seedState } from '../app/js/storage.js';

const lines = (t) => t.split('\r\n');
const prop = (t, name) => lines(t).find((l) => l.startsWith(name + ':'));
const ALL = [0, 1, 2, 3, 4, 5, 6];
const UID = 'tipnet-reminder-abc123def456@tipnet';

test('BYDAY mapping: Monday first, WEEKLY for some days, DAILY for all seven', () => {
  const now = new Date(2026, 8, 29, 12, 0);
  const t = buildIcs({ time: '02:00', days: [0, 2, 4, 5, 6], uid: UID, now });
  assert.equal(prop(t, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR,SA,SU');
  assert.equal(
    prop(buildIcs({ time: '02:00', days: [3], uid: UID, now }), 'RRULE'),
    'RRULE:FREQ=WEEKLY;BYDAY=TH',
  );
  assert.equal(prop(buildIcs({ time: '02:00', days: ALL, uid: UID, now }), 'RRULE'), 'RRULE:FREQ=DAILY');
});

test('nextStart: right now vs later today, across week, month and year ends', () => {
  // 2026-09-29 is a Tuesday (index 1)
  const at = (y, m, d, h, mi) => floating(nextStart(new Date(y, m, d, h, mi, 30), '02:00', ALL));
  assert.equal(at(2026, 8, 29, 1, 0), '20260929T020000', 'later today');
  assert.equal(at(2026, 8, 29, 2, 0), '20260930T020000', 'a moment past the time: tomorrow');
  assert.equal(at(2026, 8, 30, 23, 0), '20261001T020000', 'month end');
  assert.equal(at(2026, 11, 31, 23, 0), '20270101T020000', 'year end');
  // exactly now is not "next"
  assert.equal(floating(nextStart(new Date(2026, 8, 29, 2, 0, 0), '02:00', ALL)), '20260930T020000');
  // only Mondays: from Tuesday the next one is 2026-10-05
  assert.equal(floating(nextStart(new Date(2026, 8, 29, 12, 0), '02:00', [0])), '20261005T020000');
  // only Tuesdays, before the time today: today
  assert.equal(floating(nextStart(new Date(2026, 8, 29, 1, 0), '02:00', [1])), '20260929T020000');
  // only Tuesdays, after the time: next week
  assert.equal(floating(nextStart(new Date(2026, 8, 29, 3, 0), '02:00', [1])), '20261006T020000');
  assert.equal(nextStart(new Date(), '02:00', []), null);
  assert.equal(nextStart(new Date(), 'nope', ALL), null);
  assert.equal(
    floating(nextStart(new Date(2026, 8, 29, 0, 0), '01:30', ALL)),
    '20260929T013000',
    'late nights are fine',
  );
});

test('the event: floating DTSTART (no Z), UTC DTSTAMP, 5 minutes, alarm at start, CRLF everywhere', () => {
  const now = new Date(2026, 8, 29, 12, 0);
  const t = buildIcs({ time: '02:00', days: ALL, uid: UID, sequence: 3, now, url: 'https://x.test/tipnet/' });
  assert.ok(t.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(t), 'no bare LF');
  assert.equal(lines(t)[0], 'BEGIN:VCALENDAR');
  for (const l of [
    'VERSION:2.0',
    'PRODID:-//TipNet//Nightly reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'UID:' + UID,
    'SEQUENCE:3',
    'DURATION:PT5M',
    'SUMMARY:Log tonight in TipNet',
    'URL:https://x.test/tipnet/',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ])
    assert.ok(lines(t).includes(l), l);
  assert.match(prop(t, 'DTSTART'), /^DTSTART:[0-9]{8}T020000$/);
  assert.match(prop(t, 'DTSTAMP'), /^DTSTAMP:\d{8}T\d{6}Z$/);
  assert.match(prop(t, 'DESCRIPTION'), /https/);
  assert.throws(() => buildIcs({ time: '02:00', days: [], uid: UID }));
});

test('SEQUENCE and UID: the same UID with a higher SEQUENCE; makeUid looks right', () => {
  const now = new Date(2026, 8, 29, 12, 0);
  const a = buildIcs({ time: '02:00', days: ALL, uid: UID, sequence: 0, now });
  const b = buildIcs({ time: '03:00', days: ALL, uid: UID, sequence: 1, now });
  assert.equal(prop(a, 'UID'), prop(b, 'UID'));
  assert.equal(prop(a, 'SEQUENCE'), 'SEQUENCE:0');
  assert.equal(prop(b, 'SEQUENCE'), 'SEQUENCE:1');
  assert.match(makeUid(), /^tipnet-reminder-[a-z0-9]{16}@tipnet$/);
  assert.notEqual(makeUid(), makeUid());
});

test('escaping and folding follow RFC 5545', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const parts = fold(long).split('\r\n');
  assert.ok(parts.length > 1);
  const enc = new TextEncoder();
  parts.forEach((p, i) => {
    assert.ok(enc.encode(p).length <= 75, 'line ' + i);
    if (i) assert.ok(p.startsWith(' '));
  });
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(''), long, 'unfolds back');
  // multibyte characters are never split
  const wide = 'S:' + 'é'.repeat(100);
  const w = fold(wide).split('\r\n');
  assert.equal(w.map((p, i) => (i ? p.slice(1) : p)).join(''), wide);
  w.forEach((p) => assert.ok(enc.encode(p).length <= 75));
  // a long address in the built file stays within 75 octets per line
  const t = buildIcs({ time: '02:00', days: ALL, uid: UID, url: 'https://example.test/' + 'a'.repeat(120) });
  lines(t).forEach((l) => assert.ok(enc.encode(l).length <= 75));
});

test('labels for the "Added:" line', () => {
  assert.equal(timeLabel('02:00'), '2:00 AM');
  assert.equal(timeLabel('00:30'), '12:30 AM');
  assert.equal(timeLabel('12:05'), '12:05 PM');
  assert.equal(timeLabel('23:15'), '11:15 PM');
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5]), 'Mon–Sat');
  assert.equal(daysLabel(ALL), 'every day');
  assert.equal(daysLabel([0, 2, 4]), 'Mon, Wed, Fri');
  assert.equal(daysLabel([4, 5]), 'Fri, Sat');
  assert.deepEqual(cleanDays([3, 1, 1, 9, -1, 'x']), [1, 3]);
});

test('settings.reminder: a valid one is kept, junk is dropped', () => {
  const good = { time: '02:00', days: [0, 1], addedAt: 1760000000000, uid: UID, seq: 2 };
  const get = (reminder) => {
    const b = JSON.parse(JSON.stringify(seedState()));
    b.settings.reminder = reminder;
    return migrate(b).settings.reminder;
  };
  assert.deepEqual(get(good), good);
  for (const bad of [
    null,
    'x',
    { ...good, time: '25:00' },
    { ...good, days: [] },
    { ...good, days: [1, 1] },
    { ...good, days: [7] },
    { ...good, uid: 'evil<script>' },
    { ...good, seq: -1 },
    { ...good, addedAt: 'now' },
  ])
    assert.equal(get(bad), undefined, JSON.stringify(bad));
});

test('the boxes are the nights worked: a time before the Late-nights cutoff moves each to the next morning', () => {
  const now = new Date(2026, 8, 29, 12, 0); // Tuesday
  const t = buildIcs({ time: '02:00', days: [4, 5], uid: UID, now, cutoffHour: 6 });
  // Friday and Saturday nights at 2:00 AM: Saturday and Sunday mornings (not Thursday and Friday nights)
  assert.equal(prop(t, 'RRULE'), 'RRULE:FREQ=WEEKLY;BYDAY=SA,SU');
  assert.equal(prop(t, 'DTSTART'), 'DTSTART:20261003T020000'); // Sat Oct 3, after Friday night
  assert.deepEqual(reminderDays('02:00', [4, 5], 6), [5, 6]);
  // Saturday and Sunday nights: Sunday and Monday mornings
  assert.equal(
    prop(buildIcs({ time: '02:00', days: [5, 6], uid: UID, now, cutoffHour: 6 }), 'RRULE'),
    'RRULE:FREQ=WEEKLY;BYDAY=MO,SU',
  );
  assert.equal(
    prop(buildIcs({ time: '05:59', days: ALL, uid: UID, now, cutoffHour: 6 }), 'RRULE'),
    'RRULE:FREQ=DAILY',
  );
  // at or after the cutoff, or with Late nights off, the reminder comes on the night itself
  ['23:00', '06:00'].forEach((time) =>
    assert.equal(
      prop(buildIcs({ time, days: [4, 5], uid: UID, now, cutoffHour: 6 }), 'RRULE'),
      'RRULE:FREQ=WEEKLY;BYDAY=FR,SA',
      time,
    ),
  );
  assert.equal(
    prop(buildIcs({ time: '02:00', days: [4, 5], uid: UID, now, cutoffHour: 0 }), 'RRULE'),
    'RRULE:FREQ=WEEKLY;BYDAY=FR,SA',
  );
  assert.equal(nightsLabel([4, 5]), 'Fri, Sat nights');
  assert.equal(nightsLabel(ALL), 'every night');
});
