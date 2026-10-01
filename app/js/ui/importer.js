// Generic CSV import: map your columns, preview, then add the nights. The file is read and parsed on this device; nothing is uploaded.
import {
  parseCSV,
  guessMapping,
  namesToMapping,
  mappingToNames,
  listEmployees,
  buildNights,
  dedupeNights,
  mergeNights,
} from '../csv.js';
import { num } from '../math.js';
import { el, clear, select, money, fmtDate, toast, save, bus, getState } from './common.js';
import { lockFinished, isWorkplaceSetUp, nightsOf } from '../storage.js';

const FIELDS = [
  ['date', 'Date', true],
  ['tips', 'Tips (cash + card)', false],
  ['total', 'Total made (tips + pay)', false],
  ['cash', 'Cash tips', false],
  ['card', 'Card tips', false],
  ['hours', 'Hours', false],
  ['employee', 'Employee', false],
];
const REASONS = {
  date: 'no date we could read',
  amount: 'no amount',
  negative: 'a negative amount or hours',
  hours: 'hours we could not read, or more than 24',
};

export function renderImporter(host) {
  const S = getState();
  // The restaurants nights can go to: those set up (their paystub works the nights out). With more than one, the person
  // picks; with one, it is that one.
  const ready = S.workplaces.filter((w) => isWorkplaceSetUp(S, w));
  const st = {
    rows: null,
    header: true,
    mapping: {},
    employee: '',
    overwrite: false,
    fileName: '',
    wid: ready.length === 1 ? ready[0].id : '',
  };
  const body = el('div', { class: 'stack' });
  host.append(
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Import nights from a file'),
      el(
        'p',
        { class: 'note' },
        'Pick a .csv file, for example an export from your bar’s system. TipNet reads it on this device. Nothing is uploaded.',
      ),
      body,
    ),
  );

  const headerRow = () => (st.header ? st.rows[0] : st.rows[0].map((_, i) => 'Column ' + (i + 1)));
  const dataRows = () => (st.header ? st.rows.slice(1) : st.rows);
  const colOptions = () =>
    [['', '(none)']].concat(headerRow().map((h, i) => [String(i), String(h || 'Column ' + (i + 1))]));

  function start() {
    clear(body);
    const input = el('input', {
      type: 'file',
      accept: '.csv,text/csv,text/plain',
      class: 'input',
      'aria-label': 'Choose a CSV file',
    });
    const msg = el('p', { class: 'field-error', role: 'alert', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const rows = parseCSV(await f.text());
        if (rows.length < 1 || rows[0].length < 2) throw new Error('empty');
        st.rows = rows;
        st.fileName = f.name;
        st.header = true;
        const names = S.settings.csvMapping;
        let m = names ? namesToMapping(rows[0], names) : null;
        if (!m || m.date == null) m = guessMapping(rows[0]);
        st.mapping = m;
        st.employee = '';
        mapStep();
      } catch (e) {
        msg.hidden = false;
        msg.textContent =
          'That file could not be read as a CSV. Check that it is a .csv export and try again.';
      }
    });
    body.append(input, msg);
  }

  function mapStep() {
    clear(body);
    const hdrCb = el('input', { type: 'checkbox' });
    hdrCb.checked = st.header;
    hdrCb.addEventListener('change', () => {
      st.header = hdrCb.checked;
      st.mapping = guessMapping(headerRow());
      mapStep();
    });
    const previewRows = st.rows.slice(0, 5);
    const table = el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'table' },
        el(
          'tbody',
          null,
          previewRows.map((r, ri) =>
            el(
              'tr',
              null,
              r.map((c) => el(ri === 0 && st.header ? 'th' : 'td', null, c)),
            ),
          ),
        ),
      ),
    );
    const preview = el('div', { class: 'stack' });
    const selects = {};
    const grid = el(
      'div',
      { class: 'stack-sm' },
      FIELDS.map(([k, label, req]) => {
        const s = select(colOptions(), st.mapping[k] == null ? '' : st.mapping[k]);
        selects[k] = s;
        s.addEventListener('change', () => {
          st.mapping[k] = s.value === '' ? null : Number(s.value);
          if (k === 'employee') {
            st.employee = '';
          }
          empPick();
          refresh();
        });
        const id = 'map-' + k;
        s.id = id;
        return el('div', { class: 'field' }, el('label', { for: id }, label + (req ? '' : ' (optional)')), s);
      }),
    );
    const empHost = el('div');
    let wpField = null;
    if (ready.length > 1) {
      const s = select([['', 'Choose the restaurant']].concat(ready.map((w) => [w.id, w.name])), st.wid, {
        id: 'map-workplace',
      });
      s.addEventListener('change', () => {
        st.wid = s.value;
        refresh();
      });
      wpField = el(
        'div',
        { class: 'field' },
        el('label', { for: 'map-workplace' }, 'Which restaurant are these nights from?'),
        s,
      );
    }
    function empPick() {
      clear(empHost);
      if (st.mapping.employee == null) {
        st.employee = '';
        return;
      }
      const names = listEmployees(dataRows(), st.mapping);
      const s = select([['', 'Choose your name']].concat(names.map((n) => [n, n])), st.employee, {
        id: 'map-me',
      });
      s.addEventListener('change', () => {
        st.employee = s.value;
        refresh();
      });
      empHost.append(
        el(
          'div',
          { class: 'field' },
          el('label', { for: 'map-me' }, 'Which one is you? Only your rows are imported.'),
          s,
        ),
      );
    }
    function refresh() {
      clear(preview);
      const m = st.mapping;
      if (m.date == null) {
        preview.append(el('p', { class: 'hint' }, 'Choose the Date column to see a preview.'));
        return;
      }
      if (m.total == null && m.tips == null && m.cash == null && m.card == null && m.hours == null) {
        preview.append(
          el(
            'p',
            { class: 'hint' },
            'Choose Tips, Total made, or Cash tips, Card tips and Hours, to see a preview.',
          ),
        );
        return;
      }
      if (m.employee != null && !st.employee) {
        preview.append(el('p', { class: 'hint' }, 'Choose your name above to see a preview.'));
        return;
      }
      const w = ready.find((x) => x.id === st.wid);
      if (!w) {
        preview.append(el('p', { class: 'hint' }, 'Choose the restaurant above to see a preview.'));
        return;
      }
      const p = w.profile;
      // Hours and the hourly rate go on that restaurant's first HOURLY pay type. A per-shift type is not paid by the hour.
      const hourly = (p.payTypes || []).find((t) => t.unit === 'hr');
      const { nights, skipped } = buildNights(dataRows(), m, {
        employee: st.employee,
        refYear: new Date().getFullYear(),
        rate: hourly ? num(hourly.rate) : 0,
        payId: hourly ? hourly.id : null,
        barback: true,
      });
      nights.forEach((n) => {
        n.workplaceId = w.id;
      });
      // Duplicate dates are looked for at that restaurant only: a night at another restaurant on the same date is separate.
      const { duplicates } = dedupeNights(nights, S.nightsExample ? [] : nightsOf(S, w.id));
      preview.append(el('h3', null, 'Preview'));
      if (!nights.length) {
        preview.append(
          el('p', { class: 'note' }, 'No nights found with these choices. Check the column choices above.'),
        );
        return;
      }
      preview.append(
        el(
          'p',
          null,
          nights.length +
            ' night' +
            (nights.length > 1 ? 's' : '') +
            ' ready to import' +
            (ready.length > 1 ? ' to ' + w.name : '') +
            ', ' +
            fmtDate(nights[0].date) +
            ' to ' +
            fmtDate(nights[nights.length - 1].date) +
            '.',
        ),
      );
      preview.append(
        el(
          'ul',
          { class: 'list' },
          nights
            .slice(0, 5)
            .map((n) =>
              el(
                'li',
                { class: 'list-row' },
                el('div', { class: 'main' }, fmtDate(n.date)),
                el('div', { class: 'num' }, money(n.total)),
              ),
            ),
        ),
      );
      if (nights.length > 5)
        preview.append(el('p', { class: 'hint' }, 'and ' + (nights.length - 5) + ' more.'));
      if (m.hours != null && !hourly)
        preview.append(
          el(
            'p',
            { class: 'hint' },
            'Hours were not imported: you have no hourly pay type in Setup. Amounts come from the tips or total columns only.',
          ),
        );
      if (skipped.length) {
        const off = st.header ? 2 : 1; // the row number as your spreadsheet shows it
        preview.append(
          el('p', { class: 'hint' }, skipped.length + ' row' + (skipped.length > 1 ? 's' : '') + ' skipped:'),
          el(
            'ul',
            { class: 'list', 'aria-label': 'Skipped rows' },
            skipped.map((s) =>
              el('li', { class: 'list-row hint' }, 'Row ' + (s.row + off - 1) + ': ' + REASONS[s.reason]),
            ),
          ),
        );
      }
      if (duplicates.length) {
        const g = 'dup-choice';
        const mk = (val, text) => {
          const r = el('input', { type: 'radio', name: g });
          r.checked = st.overwrite === val;
          r.addEventListener('change', () => {
            st.overwrite = val;
          });
          return el('label', { class: 'check' }, r, el('span', null, text));
        };
        preview.append(
          el(
            'div',
            { class: 'stack-sm' },
            el(
              'p',
              { class: 'note' },
              duplicates.length +
                (duplicates.length === 1 ? ' of these dates already has' : ' of these dates already have') +
                ' a night saved.',
            ),
            mk(false, 'Keep what I have and skip those dates'),
            mk(true, 'Replace my nights on those dates'),
            ...duplicates
              .filter((d) => d.existingAll.length > 1)
              .map((d) =>
                el(
                  'p',
                  { class: 'hint' },
                  'Replacing replaces ' +
                    d.existingAll.length +
                    ' nights on ' +
                    fmtDate(d.incoming.date) +
                    ' with one.',
                ),
              ),
          ),
        );
      }
      const go = el(
        'button',
        { type: 'button', class: 'btn btn-block' },
        'Import ' + nights.length + ' night' + (nights.length > 1 ? 's' : ''),
      );
      go.addEventListener('click', () => {
        if (S.nightsExample) {
          S.nights = [];
          S.workplaces[0].calib = [];
          S.nightsExample = false;
        }
        const r = mergeNights(nightsOf(S, w.id), nights, { overwrite: st.overwrite });
        S.nights = S.nights.filter((n) => n.workplaceId !== w.id).concat(r.nights);
        lockFinished({ force: true }); // imported nights in finished periods lock now, with the current Setup
        S.settings.csvMapping = mappingToNames(headerRow(), m);
        save();
        toast(
          'Imported ' +
            (r.added + r.replaced) +
            ' night' +
            (r.added + r.replaced === 1 ? '' : 's') +
            (r.skipped ? ', skipped ' + r.skipped + ' duplicate date' + (r.skipped > 1 ? 's' : '') : '') +
            '.',
        );
        st.rows = null;
        start();
        bus.rerender();
      });
      preview.append(go);
    }
    const cancel = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary btn-small',
        onclick: () => {
          st.rows = null;
          start();
        },
      },
      'Choose a different file',
    );
    body.append(
      el('p', { class: 'hint' }, st.fileName + ': first rows'),
      table,
      el('label', { class: 'check' }, hdrCb, el('span', null, 'First row has column names')),
      el(
        'p',
        { class: 'hint' },
        'Match the columns. Tips is what you were tipped in all. TipNet adds hours times your hourly rate to get the total. If you pick Total made (tips plus pay), that is used as is. Or pick Cash tips and Card tips.',
      ),
      wpField,
      grid,
      empHost,
      preview,
      cancel,
    );
    empPick();
    refresh();
  }
  start();
}
