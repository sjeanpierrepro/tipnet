// The screens accept a decimal comma with a unit and "1 shift".
import test from 'node:test';
import assert from 'node:assert/strict';
import { hoursTypo, parseHoursInput } from '../app/js/inputs.js';

test('hours box: decimal comma with a unit, .5h, and 7½h are accepted with the right value', () => {
  for (const [t, v] of [
    ['7,5 h', 7.5],
    ['7,5h', 7.5],
    ['7,5 hrs', 7.5],
    ['7,25 hours', 7.25],
    ['.5h', 0.5],
    ['7½h', 7.5],
    ['7½ hrs', 7.5],
    ['7,5', 7.5],
  ]) {
    assert.equal(hoursTypo(t), '', t);
    assert.equal(parseHoursInput(t), v, t);
  }
  // still refused
  for (const t of ['1,250 h', '7,555h', '7,5,5h', '7 shifts', '1 shift'])
    assert.notEqual(hoursTypo(t), '', t);
});

test('shifts box accepts "1 shift" and "2 shifts"', () => {
  for (const [t, v] of [
    ['1 shift', 1],
    ['2 shifts', 2],
    ['1.5 shifts', 1.5],
    ['2shifts', 2],
    ['1,5 shifts', 1.5],
  ]) {
    assert.equal(hoursTypo(t, 'shifts'), '', t);
    assert.equal(parseHoursInput(t), v, t);
  }
  assert.notEqual(hoursTypo('shifts', 'shifts'), '');
  assert.notEqual(hoursTypo('1 shiftt', 'shifts'), '');
  assert.match(hoursTypo('x', 'shifts'), /shifts/);
});
