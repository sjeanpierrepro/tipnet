// Data source seam. See README.md in this folder. No network calls here.

/**
 * A night source: { id: string, label: string, fetchNights(range) -> Promise<night[]> }
 * range: { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' } (inclusive; both optional).
 * night: { id, date, total, cash|null, pay:{[payTypeId]:amount}, barback }
 */

/** Phase 2 placeholder. Toast's export/API is not wired up yet. */
export const toastSource = {
  id: 'toast',
  label: 'Toast',
  async fetchNights() {
    throw new Error('Toast import is not available yet.');
  },
};

export const SOURCES = { toast: toastSource };
