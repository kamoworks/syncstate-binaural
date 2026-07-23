const { test } = require('node:test');
const assert = require('node:assert/strict');
const Sequencer = require('../js/sequencer.js');
const { buildSleepProgram } = require('../js/programs.js');

/* Pins buildSchedule to the exact windows runProgram built inline before the
 * extraction (audio-engine L408-418 + _enterStage glideSec L414). */

test('buildSchedule pins sleep windows', () => {
  const sch = Sequencer.buildSchedule({ stages: buildSleepProgram(4, true), fadeOutTail: 10 }, 0);
  assert.equal(sch.stages[0].startMs, 0);
  assert.equal(sch.stages[1].startMs, 5 * 60 * 1000);          // after Settling (5m)
  assert.equal(sch.stages[2].startMs, 15 * 60 * 1000);         // after Descent (10m)
  assert.equal(sch.totalSec, 355 * 60);
  assert.equal(sch.fadeOutTail, 10);
  assert.ok(sch.stages.every(s => s.glideSec === 45));         // every sleep stage ≥5m
  assert.equal(sch.stages.at(-1).endMs, 355 * 60 * 1000);
  // contiguity: each stage starts exactly where the previous ended
  for (let i = 1; i < sch.stages.length; i++) {
    assert.equal(sch.stages[i].startMs, sch.stages[i - 1].endMs);
  }
});

test('glideSec clamps short stages', () => {
  const { stages } = Sequencer.buildSchedule({ stages: [{ minutes: 0.5 }, { minutes: 0.02 }] }, 0);
  assert.equal(stages[0].glideSec, 30);                        // min(30,45)
  assert.equal(stages[1].glideSec, 2);                         // max(2, 1.2)
});

test('empty stages → countdown-only timer', () => {
  const sch = Sequencer.buildSchedule({ stages: [], totalSec: 1200, fadeOutTail: 8 }, 0);
  assert.deepEqual(sch.stages, []);
  assert.equal(sch.totalSec, 1200);
  assert.equal(sch.fadeOutTail, 8);
});
