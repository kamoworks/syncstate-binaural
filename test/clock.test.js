const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fmtClock } = require('../js/format.js');

test('fmtClock: M:SS below an hour, H:MM:SS above', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(5), '0:05');
  assert.equal(fmtClock(59), '0:59');
  assert.equal(fmtClock(60), '1:00');
  assert.equal(fmtClock(600), '10:00');
  assert.equal(fmtClock(3600), '1:00:00');
  assert.equal(fmtClock(21230), '5:53:50');   // ~5h55m sleep program, part-way through
});

test('fmtClock: clamps negatives and rounds', () => {
  assert.equal(fmtClock(-3), '0:00');
  assert.equal(fmtClock(59.6), '1:00');
});
