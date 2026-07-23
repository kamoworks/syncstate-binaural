const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSleepProgram } = require('../js/programs.js');

/* Golden baseline for the Sleep Processor stage definition. This is the
 * deterministic fixture the whole Rigor Gate rests on: the stage list cannot
 * drift silently through any later extraction. */

const GOLDEN_4_TRUE = [
  { beat: 10,  minutes: 5,  label: 'Settling · Alpha', carrier: 180 },
  { beat: 6,   minutes: 10, label: 'Descent · Theta', carrier: 150 },
  { beat: 1.5, minutes: 45, label: 'Deep Sleep · Delta (cycle 1)', carrier: 110 },
  { beat: 5,   minutes: 25, label: 'REM · Theta (cycle 1)', carrier: 140 },
  { beat: 3,   minutes: 15, label: 'Transition · Delta-Theta', carrier: 120 },
  { beat: 1.5, minutes: 45, label: 'Deep Sleep · Delta (cycle 2)', carrier: 110 },
  { beat: 5,   minutes: 25, label: 'REM · Theta (cycle 2)', carrier: 140 },
  { beat: 3,   minutes: 15, label: 'Transition · Delta-Theta', carrier: 120 },
  { beat: 1.5, minutes: 45, label: 'Deep Sleep · Delta (cycle 3)', carrier: 110 },
  { beat: 5,   minutes: 25, label: 'REM · Theta (cycle 3)', carrier: 140 },
  { beat: 3,   minutes: 15, label: 'Transition · Delta-Theta', carrier: 120 },
  { beat: 1.5, minutes: 45, label: 'Deep Sleep · Delta (cycle 4)', carrier: 110 },
  { beat: 5,   minutes: 25, label: 'REM · Theta (cycle 4)', carrier: 140 },
  { beat: 8,   minutes: 5,  label: 'Surfacing · Alpha', carrier: 180 },
  { beat: 12,  minutes: 5,  label: 'Awakening · Low Beta', carrier: 220 },
  { beat: 20,  minutes: 5,  label: 'Awake · Beta', carrier: 260 }
];

test('sleep program (4,true) matches full golden snapshot', () => {
  const s = buildSleepProgram(4, true);
  assert.equal(s.length, 16);
  assert.equal(s.reduce((a, x) => a + x.minutes, 0), 355);        // 5h 55m
  assert.deepEqual(s, GOLDEN_4_TRUE);
});

test('sleep program (1,false): no wake, no inter-cycle transition', () => {
  const s = buildSleepProgram(1, false);
  assert.equal(s.length, 4);                                      // 2 lead-in + 1×(Delta,REM)
  assert.equal(s.at(-1).label, 'REM · Theta (cycle 1)');
  assert.equal(s.reduce((a, x) => a + x.minutes, 0), 85);         // 5+10+45+25
});
