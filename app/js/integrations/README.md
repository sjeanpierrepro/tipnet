# Integrations (the Toast seam)

A source is any object with this shape:

```js
{ id: 'csv', label: 'CSV file', fetchNights(range) -> Promise<night[]> }
```

- `range` is `{ from?, to? }` with `YYYY-MM-DD` strings (inclusive, both optional).
- A `night` is `{ id, date, total, cash|null, pay: {[payTypeId]: amount}, barback }`, the same shape the app stores.
- Sources only return nights. The UI decides what to import (dedupe with `dedupeNights` / `mergeNights` in `../csv.js`).

`source.js` has:

- `csvSource({ text, mapping, opts, hasHeader })`: parses a CSV the user picked, on the device.
- `toastSource`: a stub. `fetchNights()` throws "Toast import is not available yet."

To add Toast in Phase 2 with a CSV export, add a `toast` entry to `MAPPING_PRESETS` in `../csv.js`
(there is a commented placeholder). Nothing here makes network calls, and none should be added to the app.
