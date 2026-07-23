const { test } = require('node:test');
const assert = require('node:assert/strict');
const Sequencer = require('../js/sequencer.js');
const { buildSleepProgram } = require('../js/programs.js');

const sched = Sequencer.buildSchedule({ stages: buildSleepProgram(4, true), fadeOutTail: 10 }, 0);
const MS = 60 * 1000;

test('before start → stageIndex -1, elapsed 0', () => {
  const r = Sequencer.resolve(sched, -5);
  assert.equal(r.stageIndex, -1);
  assert.equal(r.elapsed, 0);
});

test('mid stage 0', () => {
  const r = Sequencer.resolve(sched, 2 * MS);            // 2 min into the 5-min Settling stage
  assert.equal(r.stageIndex, 0);
  assert.equal(r.stageElapsed, 120);
  assert.equal(r.remaining, 355 * 60 - 120);
});

test('throttle jump past several boundaries → latest passed stage', () => {
  // stage starts (min): 0,5,15,60,85,100,... ; now=90min → last start ≤90 is s4 (85)
  assert.equal(Sequencer.resolve(sched, 90 * MS).stageIndex, 4);
});

test('at/after end → atEnd, remaining 0', () => {
  const r = Sequencer.resolve(sched, 355 * MS + 5000);
  assert.equal(r.atEnd, true);
  assert.equal(r.remaining, 0);
});

test('idempotent in now', () => {
  assert.deepEqual(Sequencer.resolve(sched, 42 * MS), Sequencer.resolve(sched, 42 * MS));
});
