// Nightly reminder as a calendar event (.ics). Pure functions: no screens, no storage, no network.
// Days are 0 = Monday ... 6 = Sunday. Times are "HH:MM" on a 24-hour clock, in the phone's own time (floating).

export const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const p2 = (n) => String(n).padStart(2, '0');
const dayIndex = (d) => (d.getDay() + 6) % 7; // JS Sunday = 0 -> our Monday = 0

/** Sorted, unique days 0-6 from anything; junk is dropped. */
export function cleanDays(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

/** A stable per-device id for the calendar event. */
export function makeUid(rand = Math.random) {
  let s = '';
  while (s.length < 16) s += Math.floor(rand() * 36).toString(36);
  return 'tipnet-reminder-' + s + '@tipnet';
}
export const UID_RE = /^tipnet-reminder-[a-z0-9]{6,40}@tipnet$/;

/** The first moment after `now` that falls on a chosen day at `time`, as a local Date. */
export function nextStart(now, time, days) {
  const m = TIME_RE.exec(time);
  const set = cleanDays(days);
  if (!m || !set.length) return null;
  for (let add = 0; add <= 7; add++) {
    const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, +m[1], +m[2], 0, 0);
    if (c.getTime() > now.getTime() && set.includes(dayIndex(c))) return c;
  }
  return null;
}

/** Floating local time: YYYYMMDDTHHMMSS (no Z, no zone). */
export const floating = (d) =>
  d.getFullYear() +
  p2(d.getMonth() + 1) +
  p2(d.getDate()) +
  'T' +
  p2(d.getHours()) +
  p2(d.getMinutes()) +
  p2(d.getSeconds());
export const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** RFC 5545 TEXT escaping. */
export const escapeText = (s) =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Fold a content line to at most 75 octets per line (CRLF + space); never splits a UTF-8 character. */
export function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let used = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (used + n > limit) {
      out.push(cur);
      cur = '';
      used = 0;
      limit = 74; // the leading space counts as one octet
    }
    cur += ch;
    used += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** "2:00 AM" from "02:00". */
export function timeLabel(time) {
  const m = TIME_RE.exec(time);
  if (!m) return '';
  const h = +m[1];
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

/** True for a reminder time from 12:00 AM to 11:59 AM: it goes off the morning after each night ticked. */
export const isMorning = (time) => {
  const m = TIME_RE.exec(time);
  return !!m && +m[1] < 12;
};
/**
 * The days the reminder goes off, from the NIGHTS ticked (0 = Monday night): a time before noon (12:00 AM to 11:59 AM)
 * is the morning after, so each night moves on a day (Friday and Saturday nights at 2:00 AM are Saturday and Sunday
 * mornings; Sunday night is Monday). 12:00 PM to 11:59 PM is the night itself. The Late-nights cutoff plays no part.
 */
export function reminderDays(time, nights) {
  const set = cleanDays(nights);
  return isMorning(time) ? cleanDays(set.map((d) => (d + 1) % 7)) : set;
}

/** "every day", "Mon–Sat", "Mon, Wed, Fri". */
export function daysLabel(days) {
  const d = cleanDays(days);
  if (d.length === 7) return 'every day';
  if (d.length >= 3 && d[d.length - 1] - d[0] === d.length - 1)
    return DAY_NAMES[d[0]] + '–' + DAY_NAMES[d[d.length - 1]];
  return d.map((i) => DAY_NAMES[i]).join(', ');
}
/** "every night", "Mon–Sat nights", "Fri, Sat nights": the nights a reminder is for. */
export const nightsLabel = (days) =>
  cleanDays(days).length === 7 ? 'every night' : daysLabel(days) + ' nights';

/**
 * The .ics text for the nightly reminder.
 * { time, days (the nights worked; see reminderDays), uid, sequence, now (Date), url } -> string with CRLF line endings.
 */
export function buildIcs({ time, days, uid, sequence = 0, now = new Date(), url = '' }) {
  const set = reminderDays(time, days);
  const start = nextStart(now, time, set);
  if (!start) throw new Error('Pick a time and at least one day.');
  const rrule =
    set.length === 7 ? 'FREQ=DAILY' : 'FREQ=WEEKLY;BYDAY=' + set.map((i) => DAY_CODES[i]).join(',');
  const desc = 'Log tonight in TipNet' + (url ? ': ' + url : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TipNet//Nightly reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'SEQUENCE:' + sequence,
    'DTSTAMP:' + utcStamp(now),
    'DTSTART:' + floating(start),
    'DURATION:PT5M',
    'RRULE:' + rrule,
    'SUMMARY:' + escapeText('Log tonight in TipNet'),
    'DESCRIPTION:' + escapeText(desc),
  ];
  if (url) lines.push('URL:' + url);
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + escapeText('Log tonight in TipNet'),
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return lines.map(fold).join('\r\n') + '\r\n';
}
