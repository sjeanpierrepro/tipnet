// Data source seam. See README.md in this folder. No network calls here.
import { parseCSV, buildNights } from '../csv.js';

/**
 * A night source: { id: string, label: string, fetchNights(range) -> Promise<night[]> }
 * range: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' } (inclusive; both optional).
 * night: { id, date, total, cash|null, pay:{[payTypeId]:amount}, barback }
 */

const inRange = (n, range = {}) => (!range.from || n.date >= range.from) && (!range.to || n.date <= range.to);

/**
 * csvSource({text, mapping, opts, hasHeader = true}): parses a CSV string the user picked.
 * mapping = column indexes (see csv.js buildNights); opts are buildNights options.
 */
export function csvSource({ text, mapping, opts = {}, hasHeader = true }) {
  return {
    id: 'csv',
    label: 'CSV file',
    async fetchNights(range) {
      const rows = parseCSV(text);
      const data = hasHeader ? rows.slice(1) : rows;
      return buildNights(data, mapping, opts).nights.filter((n) => inRange(n, range));
    },
  };
}

/** Phase 2 placeholder. Toast's export/API is not wired up yet. */
export const toastSource = {
  id: 'toast',
  label: 'Toast',
  async fetchNights() {
    throw new Error('Toast import is not available yet.');
  },
};

export const SOURCES = { csv: csvSource, toast: toastSource };
