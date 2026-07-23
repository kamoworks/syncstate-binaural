const { test } = require('node:test');
const assert = require('node:assert/strict');
const Sequencer = require('../js/sequencer.js');
const { buildSleepProgram } = require('../js/programs.js');

/* ---- Golden reference oracle ----
 * The current inline decision logic transcribed verbatim from audio-engine.js
 * as it stood BEFORE Patch 3: _schedulerTick (L362-384) + _programTick
 * (L490-501), effects stripped to recorded events. `_loop` is treated as
 * present (an invariant during an active session — it is set before playback
 * begins and only cleared on stop, when ticks are already guarded off).
 *
 * Both this oracle and the extracted Sequencer are driven from ONE injected
 * clock. The live engine's two separate Date.now() calls (stage schedule vs.
 * session countdown) differ by a sub-millisecond epsilon that rounds away; the
 * single-clock characterization is the deterministic form of that behaviour. */
function referenceStream(schedule, timeline, { program }) {
  let fadeArmed = false;
  let current = program ? 0 : -1;                              // runProgram enters stage 0 eagerly
  const sessionEnd = schedule.startMs + schedule.totalSec * 1000;
  const fadeOutTail = schedule.fadeOutTail;
  const events = [];
  for (const now of timeline) {
    const ev = { now, onTick: null, armFade: null, finished: false, entered: null };
    const remain = Math.max(0, Math.round((sessionEnd - now) / 1000));            // L368
    ev.onTick = remain;                                                           // L369
    if (!fadeArmed && remain > 0 && remain <= fadeOutTail) {                      // L372 (loop present)
      fadeArmed = true; ev.armFade = fadeOutTail;                                 // L373-377
    } else if (remain <= 0 && !fadeArmed) {                                       // L378
      ev.finished = true;                                                        // L379 → _finish clears program
    }
    if (!ev.finished && program && current >= 0) {                               // L383 → _programTick, L492
      let target = current;
      for (let j = current + 1; j < schedule.stages.length; j++) {               // L495
        if (now >= schedule.stages[j].startMs) target = j;                       // L496
      }
      if (target > current) { ev.entered = target; current = target; }           // L498-499
    }
    events.push(ev);
    if (ev.finished) break;                                                      // interval cleared in _finish
  }
  return events;
}

/* Drive the extracted Sequencer over the same timeline, projected to the same
 * event shape the oracle records. */
function seqStream(schedule, timeline, { program }) {
  const seq = new Sequencer();
  seq._schedule = schedule; seq._current = program ? 0 : -1; seq._fadeArmed = false;
  const events = [];
  for (const now of timeline) {
    const r = seq.tick(now);
    events.push({
      now,
      onTick: Math.max(0, Math.round(r.remaining)),
      armFade: r.armFade,
      finished: r.finished,
      entered: r.entered ? r.entered.index : null
    });
    if (r.finished) break;
  }
  return events;
}

const prog = Sequencer.buildSchedule({ stages: buildSleepProgram(4, true), fadeOutTail: 10 }, 0);
const MS = 60 * 1000;

test('program: normal per-minute advance matches the oracle', () => {
  const timeline = [];
  for (let m = 0; m <= 355; m++) timeline.push(m * MS + 500);            // 0.5 s into each minute
  assert.deepEqual(seqStream(prog, timeline, { program: true }),
                   referenceStream(prog, timeline, { program: true }));
});

test('program: multi-stage throttle jump → single entered = latest stage', () => {
  const timeline = [1 * MS, 2 * MS, 200 * MS, 201 * MS];                 // one wakeup skips many stages
  const s = seqStream(prog, timeline, { program: true });
  assert.deepEqual(s, referenceStream(prog, timeline, { program: true }));
  assert.equal(s[2].entered, 8);                                         // Deep Sleep · Delta (cycle 3), start 185m
});

test('program: fade arms exactly once; no tick-level finish after arming', () => {
  // session = 21300 s; fade window is remaining ∈ (0, 10]  →  now ∈ [21290, 21300) s
  const timeline = [21285, 21291, 21292, 21299, 21300, 21301].map(s => s * 1000);
  const s = seqStream(prog, timeline, { program: true });
  assert.deepEqual(s, referenceStream(prog, timeline, { program: true }));
  assert.equal(s.filter(e => e.armFade != null).length, 1);
  assert.ok(s.every(e => !e.finished));      // finish comes from the fade one-shot, not a tick
});

test('program: throttle jump past the end finishes without entering', () => {
  const timeline = [100 * MS, 400 * MS];                                 // second tick is past session end
  const s = seqStream(prog, timeline, { program: true });
  assert.deepEqual(s, referenceStream(prog, timeline, { program: true }));
  assert.equal(s[1].finished, true);
  assert.equal(s[1].entered, null);          // finish suppresses stage entry
});

test('plain session: countdown + fade + finish matches the oracle', () => {
  const plain = Sequencer.buildSchedule({ stages: [], totalSec: 20 * 60, fadeOutTail: 8 }, 0);
  const timeline = [];
  for (let s = 0; s <= 1188; s += 30) timeline.push(s * 1000 + 250);
  [1191, 1192, 1199, 1200, 1201].forEach(s => timeline.push(s * 1000));  // finer near the fade window
  const out = seqStream(plain, timeline, { program: false });
  assert.deepEqual(out, referenceStream(plain, timeline, { program: false }));
  assert.equal(out.filter(e => e.armFade != null).length, 1);            // arms at remaining = 8 s
  assert.ok(out.every(e => e.entered === null));                         // stageless: never a stage entry
});
