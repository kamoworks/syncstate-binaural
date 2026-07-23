/* ============================================================
 * SyncState Sequencer Core — pure ordered-field scheduler.
 * (docs/SPEC-SEQUENCER-CORE-2026-07-23.md). No DOM / Date /
 * WebAudio: the engine owns the clock + effects, this owns the
 * meaning of a tick. Phase 1 reproduces today's scheduling math
 * exactly; the transition-aware Stage model arrives in Phase 2.
 *
 * Two layers:
 *  - pure statics buildSchedule() + resolve() (the state observer)
 *  - a thin stateful shell tracking _current / _fadeArmed that turns
 *    a wall-clock `now` into an actionable TickResult, reproducing the
 *    old inline _schedulerTick + _programTick decision stream 1:1.
 * ============================================================ */
class Sequencer {
  /* pure: absolute wall-clock windows per stage. startMs injected.
   * glideSec reproduces _enterStage's clamp verbatim (audio-engine L414). */
  static buildSchedule(seq, startMs) {
    const fadeOutTail = seq.fadeOutTail != null ? seq.fadeOutTail : 8;
    const src = seq.stages || [];
    let acc = 0;
    const stages = src.map((st, i) => {
      const start = startMs + acc * 1000;
      const durSec = st.minutes * 60;
      acc += durSec;
      return { ...st, index: i, startMs: start, endMs: startMs + acc * 1000,
               glideSec: Math.max(2, Math.min(durSec, 45)) };
    });
    return { stages, startMs, fadeOutTail,
             totalSec: src.length ? acc : (seq.totalSec || 0) };
  }

  /* pure: authoritative session/stage position for `now`. No side effects.
   * Forward-scan = the old _programTick loop (L490-501) made stateless:
   * the latest stage whose startMs ≤ now, so one throttled wakeup that
   * skipped several stages lands directly on the correct one. */
  static resolve(schedule, now) {
    const total = schedule.totalSec;
    const elapsed = Math.max(0, (now - schedule.startMs) / 1000);
    let stageIndex = -1;
    for (let j = 0; j < schedule.stages.length; j++) {
      if (now >= schedule.stages[j].startMs) stageIndex = j; else break;
    }
    const st = stageIndex >= 0 ? schedule.stages[stageIndex] : null;
    return {
      stageIndex,
      stageElapsed: st ? Math.max(0, (now - st.startMs) / 1000) : 0,
      elapsed,
      remaining: Math.max(0, total - elapsed),
      total,
      atEnd: elapsed >= total
    };
  }

  constructor() {
    this._schedule = null;
    this._current = -1;
    this._fadeArmed = false;
  }

  load(seq, startMs) {
    this._schedule = Sequencer.buildSchedule(seq, startMs);
    this._current = -1;
    this._fadeArmed = false;
    return this._schedule;
  }

  reset() { this._schedule = null; this._current = -1; this._fadeArmed = false; }

  get active()       { return !!this._schedule; }
  get isProgram()    { return !!this._schedule && this._schedule.stages.length > 0; }
  get schedule()     { return this._schedule; }
  get currentIndex() { return this._current; }
  get wasFadeArmed() { return this._fadeArmed; }
  currentStage()     { return this._current >= 0 && this._schedule ? this._schedule.stages[this._current] : null; }
  get currentLabel() { const s = this.currentStage(); return s ? s.label : null; }

  /* pure read of position for re-anchoring the lock screen (no state change) */
  peek(now) { return this._schedule ? Sequencer.resolve(this._schedule, now) : null; }

  _bundle(i) {
    const s = this._schedule.stages;
    return { entered: s[i], prev: s[i - 1] || null, next: s[i + 1] || null, release: s[i - 2] || null, index: i };
  }

  /* Eager entry — preserves runProgram's synchronous stage-0 claim with fadeIn.
   * Sets _current before the async render, so a late render can't double-enter. */
  enter(i) {
    if (!this._schedule || i >= this._schedule.stages.length) return null;
    this._current = i;
    return this._bundle(i);
  }

  /* The one call the engine makes each tick. Idempotent in `now`: the same `now`
   * after advancing returns entered=null/armFade=null but the same remaining.
   * Reproduces the old inline _schedulerTick (L362-384) + _programTick decisions:
   * fade/finish are decided on the WHOLE-SECOND remainder, exactly as before. */
  tick(now) {
    const sch = this._schedule;
    if (!sch) return null;
    const r = Sequencer.resolve(sch, now);
    const remainWhole = Math.max(0, Math.round(r.remaining));   // old L368
    const out = {
      stageIndex: this._current, entered: null, prev: null, next: null, release: null,
      elapsed: r.elapsed, remaining: r.remaining, total: r.total,
      armFade: null, finished: false
    };
    // fade-arm (once) / finish — decided on remainWhole (old L372 / L378)
    if (!this._fadeArmed && remainWhole > 0 && remainWhole <= sch.fadeOutTail) {
      this._fadeArmed = true;
      out.armFade = sch.fadeOutTail;
    } else if (remainWhole <= 0 && !this._fadeArmed) {
      out.finished = true;
      return out;                     // finish suppresses stage entry (old _finish → _programTick no-op)
    }
    // stage transition — advance only, to the latest passed stage (old _programTick)
    if (sch.stages.length && this._current >= 0 && r.stageIndex > this._current) {
      const b = this._bundle(r.stageIndex);
      this._current = r.stageIndex;
      out.entered = b.entered; out.prev = b.prev; out.next = b.next; out.release = b.release;
      out.stageIndex = r.stageIndex;
    }
    return out;
  }
}
if (typeof window !== 'undefined') window.Sequencer = Sequencer;
if (typeof module !== 'undefined' && module.exports) module.exports = Sequencer;
