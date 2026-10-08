# Integrations (the Toast seam)

A source is any object with this shape:

```js
{ id: 'toast', label: 'Toast', fetchNights(range) -> Promise<night[]> }
```

- `range` is `{ from?, to? }` with `YYYY-MM-DD` strings (inclusive, both optional).
- A `night` is `{ id, date, total, cash|null, pay: {[payTypeId]: amount}, barback }`, the same shape the app stores.
- Sources only return nights.

`source.js` has `toastSource`: a stub. `fetchNights()` throws "Toast import is not available yet."

TipNet has no spreadsheet (CSV) import (owner decision, see DECISIONS.md). Nothing here makes network calls, and none should be added to the app.
