// Sixth review, valid entries refused: Setup's "Shifts you work in a pay period" refused "10 shifts" (it used the money
// reader) while Tonight's Shifts box takes "2 shifts"; an hours box refused "45 min" / "45m" / "45 mins". Both are read
// now; junk is still refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHoursInput, hoursTypo, readShiftCount } from '../app/js/inputs.js';

test('hours: minutes alone are read as hours (45 min = 0.75 h); junk is still refused', () => {
  for (const [t, h] of [
    ['45 min', 0.75],
    ['45m', 0.75],
    ['45 mins', 0.75],
    ['45 minutes', 0.75],
    ['45min', 0.75],
    ['90 min', 1.5],
    ['30 m.', 0.5],
    ['-45 min', -0.75],
  ]) {
    assert.equal(hoursTypo(t), '', t);
    assert.equal(parseHoursInput(t), h, t);
  }
  for (const t of ['45 mn', 'min', '45 min abc', '45 minx', 'm', '4 5 min', '45 min 3'])
    assert.match(hoursTypo(t), /^That isn’t a number of hours\./, t);
  // a Shifts box doesn't take minutes
  assert.match(hoursTypo('45 min', 'shifts'), /number of shifts/);
});

test('Setup shift count: "10 shifts" / "10 shift" read as 10, like Tonight’s Shifts box; junk is still a typo', () => {
  for (const t of ['10', '10 shifts', '10 shift', '10shifts', ' 10 Shifts ', '10.0'])
    assert.equal(readShiftCount(t), 10, t);
  assert.equal(readShiftCount(''), null);
  for (const t of ['shifts', '10 shiftss', '1.2.3', 'ten', '10 hours', '10 shifts 2'])
    assert.ok(Number.isNaN(readShiftCount(t)), t);
});
