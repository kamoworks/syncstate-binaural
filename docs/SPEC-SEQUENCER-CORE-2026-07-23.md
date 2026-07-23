# Spec: Sequencer Core (2026-07-23)

**Status: PROPOSED — awaiting Kamo's greenlight on Phase 1.**

Context: SyncState is already a five-stage closed-loop control system (state →
declarative program → render → sequencer → feedback), but the sequencer — the
part that decides *which ordered setpoint should be live right now and how we
arrive at it* — is hand-woven through `audio-engine.js` and hardwired to the
Sleep Processor. This spec extracts that logic into one pure, testable
**Sequencer** operating on a declarative **Sequence**, mirroring exactly how
`render-core.js` already separates pure schedule math (`snapLoopSeconds`,
`applyEdgeFade`) from WebAudio.

This is a **refactor-extract of code that already works**, not a new feature.
The Sleep Processor is the reference behaviour; it must run identically before
and after. The payoff (My States, Glide Engine, stage-timeline UI) is *unlocked*
by the seam but explicitly **not built in Phase 1**.

Companion to `SPEC-V3-EXPERIENCE-UPGRADE-2026-07-23.md`: this is the structural
substrate its Pillar 2 (Glide) and Pillar 3 (My States, stage timeline) ride on.

---

## Part 0 — The architectural contract (one sentence)

> **The engine owns the clock and the effectors; the Sequencer owns the meaning
> of a tick.**

- **Engine** decides *when* to tick (foreground `setInterval`, the transport's
  `timeupdate`, resume-after-pause resync) and performs every side effect
  (render a setpoint, play/hand-off blobs, fire `onTick`/`onStage`/`onEnded`,
  publish lock-screen position). It keeps sole ownership of `RenderCore` and
  `MediaTransport`.
- **Sequencer** is a pure state machine: given an immutable schedule and a
  wall-clock `now`, it answers *which stage is authoritative, how far through
  the session we are, whether to arm the fade-out, whether we are finished.* It
  imports nothing, touches no DOM, no `Date`, no audio.

Everything below is the mechanical consequence of that contract.

---

## Part 1 — Precise extraction map

Current file: `js/audio-engine.js` (class `BinauralEngine`). Line numbers are the
current approximate locations.

### 1.1 State variables

| Var | Now (approx) | Destination | Note |
|---|---|---|---|
| `_program` | L66 | **Sequencer** (`_schedule`, `_current`) | The whole scheduled-stage object becomes the Sequencer's internal schedule. |
| `_sessionEnd` | L67 | **Sequencer** (derived from `startMs + totalSec`) | Absolute end no longer stored on the engine. |
| `_sessionLenSec` | L68 | **Sequencer** (`schedule.totalSec`) | |
| `_fadeArmed` | L71 | **Sequencer** (`_fadeArmed`) | The fire-once guard for the fade-out moves with the decision. |
| `_lastTickMs` | L70 | **Engine (stays)** | Throttle guard for `ontimeupdate` cadence — a clock concern. |
| `_tickInterval` | L69 | **Engine (stays)** | The engine owns the clock source. |
| `onTick`, `onStage`, `onEnded` | L73–75 | **Engine (stays, public API)** | app.js subscribes to these. The Sequencer is invisible to app.js. |

### 1.2 Methods

| Method | Now | Split | Moves to Sequencer | Stays in Engine |
|---|---|---|---|---|
| `runProgram(stages, opts)` | L405–426 | ✂ | schedule construction (L408–418) → `buildSchedule` | orchestration: mark running, `_enterStage(0)`, start clock |
| `_programTick(now)` | L500–511 | → | **entire forward-scan** (find latest stage with `startMs ≤ now`) → `resolve()` | — |
| `_clearProgram()` | L513–515 | → | `reset()` | — |
| `startSessionTimer(minutes)` | L349–360 | ✂ | countdown setup (`totalSec`, reset fade) | clock ownership (`setInterval`), the mid-fade "back to loop" effect (L352–355) |
| `_schedulerTick()` | L362–384 | ✂ | remaining/elapsed math, fade-arm decision, finish decision, stage-target decision → `tick(now)` returns a `TickResult` | reading the `TickResult` and performing effects (onTick, publish position, play fade blob, `_finish`) |
| `_finish()` | L386–396 | ✂ | signalled by `TickResult.finished` | teardown: clear interval, `_renderSeq++`, stop transport, fire `onEnded` |
| `_enterStage(i, opts)` | L456–498 | ✂ | index bookkeeping: which is `prev`, `next` (prefetch), `release` (free two back) → carried on `TickResult` | render (`_renderStageAssets`), set `state.beat/carrier`, `playThenLoop`, fire `onStage`, `_updateNowPlaying` |
| `_renderStageAssets(st, prev)` | L428–454 | ✗ | — | **stays whole** — this is rendering, the engine's job |
| `_publishPosition()` | L128–132 | ✂ | elapsed/total is read from the `TickResult` | the `_t().setPosition(...)` transport call stays |
| `_nowPlayingTitle()` | L142–148 | ✗ | reads `schedule.stages[current].label` via a getter | stays (it's a transport/metadata concern) |

### 1.3 What the engine keeps, entire and untouched

`_rebuild`, `_scheduleRebuild`, `setParam` and all parameter setters, capture /
preview choreography (`beginCapture`…`resumeAfterCapture`), `start`, `stop`,
`recoverPlayback`, the affirmation pipeline (`loadAffirmation`,
`processVoiceBlob`, `getMeters`), the visualizer shim, and **all of
`MediaTransport` / `RenderCore`**. The transport already knows nothing about time
or stages (`playLoop`, `playThenLoop`, `playOnce`, `position()`), so the seam is
clean — the Sequencer never references it.

---

## Part 2 — Data models (TypeScript-ready)

Types are documentation; the shipped code is JS with these shapes as JSDoc.
`Partial<StateVector>` is used for stage targets so a stage overrides only the
axes it cares about (a sleep stage sets `beat`/`carrier`; everything else is
inherited from the live state at load time — this is exactly today's behaviour,
where `_renderStageAssets` spreads `{...this.state, beat, carrier}`).

```ts
/** A complete, renderable target field configuration.
 *  This is `engine.state` promoted to a first-class, serializable object.
 *  Invariant: every numeric axis is finite; carrier > 0; beat ∈ [0.25, 45]. */
interface StateVector {
  carrier: number;      // Hz base tone,  (0, ∞)
  beat: number;         // Hz binaural difference, [0.25, 45]
  volume: number;       // [0,1]
  toneLevel: number;    // [0,1]
  noiseLevel: number;   // [0,1]
  septon: boolean;
  monaural: number;     // [0,1] AM depth when septon on
  balance: number;      // [-1,1] ear balance
  fm: { on: boolean; carrier: number; rate: number; depth: number;
        level: number; oneDivF: boolean };
  aff: { on: boolean; ratio: number };
}

/** How the engine ARRIVES at a stage's target.
 *  'cut'  = swap in (plain sessions, preset taps today).
 *  'glide'= rendered ramp from the previous setpoint (sleep stage glides today,
 *           and the whole of V3 Pillar 2). Invariant: seconds ∈ [2, 45]
 *           (matches the current `glideSec = clamp(minutes*60, 2, 45)`). */
interface Transition { kind: 'cut' | 'glide'; seconds: number; }

/** One ordered step: hold `target` for `minutes`, arriving via `transition`.
 *  Invariant: minutes > 0; `id` unique within its Sequence. */
interface Stage {
  id: string;
  label: string;               // shown on lock screen + Now Playing
  target: Partial<StateVector>;
  minutes: number;
  transition: Transition;
}

/** A measure→adjust rule that lets a Sequence be closed-loop instead of pure
 *  wall-clock. The generalization of today's cover-envelope → affirmation-gain
 *  law. Phase 1 ships NO feedback hooks; the sleep program passes `undefined`.
 *  Pure: `measure`/`adjust` must not perform I/O; the engine supplies `ctx`. */
interface FeedbackHook {
  measure(ctx: FeedbackCtx): number;                 // a scalar signal
  adjust(signal: number, stage: Stage): Partial<StateVector>;
}
interface FeedbackCtx { coverEnv: number; elapsed: number; stageElapsed: number; }

/** The whole ordered process. SleepProgram, a preset session, a saved
 *  "My State", and a single Glide are all just Sequences of length ≥ 1 (or 0
 *  for a bare countdown timer).
 *  Invariant: stages ordered as authored; fadeOutTail ≥ 0. */
interface Sequence {
  id: string;
  label: string;
  stages: Stage[];             // [] = countdown-only timer (plain session)
  fadeOutTail: number;         // seconds; 8 for plain, 10 for programs (today's values)
  feedback?: FeedbackHook;     // Phase 1: always absent
}
```

Derived (Sequencer-internal, not authored):

```ts
/** A stage with its resolved absolute wall-clock window. Output of buildSchedule. */
interface ScheduledStage extends Stage {
  index: number;
  startMs: number;   // absolute epoch ms
  endMs: number;
  glideSec: number;  // == transition.seconds, clamped
}
interface Schedule {
  stages: ScheduledStage[];
  startMs: number;
  totalSec: number;  // Σ stage.minutes*60  (or the plain-timer length)
  fadeOutTail: number;
}
```

---

## Part 3 — The Sequencer

Two layers: a **pure core** (`buildSchedule`, `resolve`) that the tests hammer,
and a **thin stateful shell** (`Sequencer`) that tracks `_current` / `_fadeArmed`
and turns a `now` into an actionable `TickResult`.

### 3.1 Pure core

```ts
/** Pure. No Date, no side effects. startMs is injected by the caller. */
function buildSchedule(seq: Sequence, startMs: number): Schedule

/** Pure. The state observer. Given a schedule and a wall-clock `now`, return
 *  the authoritative session/stage position — independent of how many ticks
 *  were missed. Calling it twice at the same `now` yields identical output. */
function resolve(schedule: Schedule, now: number): Resolved

interface Resolved {
  stageIndex: number;      // latest stage with startMs ≤ now (−1 before start / empty)
  stageElapsed: number;    // s since that stage's startMs
  elapsed: number;         // s since schedule.startMs, clamped ≥ 0
  remaining: number;       // totalSec − elapsed, clamped ≥ 0
  total: number;
  atEnd: boolean;          // remaining ≤ 0
}
```

`resolve`'s forward-scan is today's `_programTick` loop (L504–510) made pure:
scan for the **latest** stage whose `startMs ≤ now`, so a single throttled
background wakeup that skipped three stages lands directly on the correct one.

### 3.2 Stateful shell + `TickResult`

```ts
class Sequencer {
  load(seq: Sequence, opts: { startMs: number }): void   // build+store, _current=-1, _fadeArmed=false
  tick(now: number): TickResult                          // the one call the engine makes each tick
  reset(): void                                          // _clearProgram equivalent
  get currentLabel(): string | null                      // for _nowPlayingTitle
  get wasFadeArmed(): boolean                             // for the mid-fade "back to loop" edge case
}

interface TickResult {
  stageIndex: number;
  entered: ScheduledStage | null;   // non-null ONLY on the tick a new stage becomes active
  prev:    ScheduledStage | null;   // stage before `entered` — the glide-from source
  next:    ScheduledStage | null;   // stage after active — prefetch target
  release: ScheduledStage | null;   // active.index − 2 — free its rendered assets
  elapsed: number;
  remaining: number;
  total: number;
  armFade: number | null;           // fadeOutTail, non-null on the ONE tick fade should arm
  finished: boolean;                // remaining ≤ 0 and fade never armed → finish immediately
}
```

### 3.3 Tick semantics (exact, reproduces today's `_schedulerTick`)

On `tick(now)` the shell calls `resolve`, then:

1. `elapsed/remaining/total` copied straight from `Resolved`.
2. **Stage transition:** if `resolved.stageIndex > _current`, set
   `entered = stages[stageIndex]`, `prev = stages[stageIndex-1] ?? null`,
   `next = stages[stageIndex+1] ?? null`,
   `release = stages[stageIndex-2] ?? null`, then `_current = stageIndex`.
   Otherwise all four are `null`. (A jump of >1 still emits a single `entered`
   for the target stage — identical to today, where `_programTick` calls
   `_enterStage(target)` once.)
3. **Fade arm:** if `!_fadeArmed && remaining > 0 && remaining ≤ fadeOutTail`,
   set `armFade = fadeOutTail` and `_fadeArmed = true`. Else `armFade = null`.
4. **Finish:** if `remaining ≤ 0 && !_fadeArmed`, `finished = true`. Else `false`.
   (Once fade is armed, the fade-out one-shot's completion drives finish via the
   engine — the Sequencer stays quiet, exactly as `_fadeArmed` gates today.)

### 3.4 Wall-clock self-correction contract

- **Stateless in `now`.** `resolve(schedule, now)` depends only on its arguments.
  The only shell state is `_current` (monotonic, to detect *transitions*) and
  `_fadeArmed` (fire-once). Neither depends on tick cadence.
- **Idempotent.** `tick(T)` twice ⇒ the second returns `entered=null, armFade=null`
  (already advanced) but the *same* `stageIndex/remaining`. No double-enter, no
  double-fade — this is the guarantee the old `p.current` claim-before-await and
  `_fadeArmed` guard provided, now centralized.
- **Catch-up, not replay.** A gap of any size collapses to the correct stage;
  intermediate stages are never "played late." Matches today's behaviour where a
  backgrounded wrap simply continues the current loop until JS resumes.

### 3.5 Subscription model (engine retains render + transport)

The engine holds one Sequencer and consumes its `TickResult` — that *is* the
subscription. app.js sees no change. The engine's `_schedulerTick` becomes:

```js
_schedulerTick() {
  this._lastTickMs = Date.now();
  if (!this.running || this.paused || this._stopping) return;
  const r = this._seq.tick(Date.now());

  this.onTick && this.onTick(Math.round(r.remaining));   // → app.js UI
  this._t().setPosition(r.elapsed, r.total);             // lock screen

  if (r.entered) this._playStage(r);                     // render+play+onStage+prefetch+free
  if (r.armFade != null) this._armFadeOut(r.armFade);    // play fade-out one-shot → _finish
  else if (r.finished)   this._finish();
}
```

`_playStage(r)` is the surviving body of `_enterStage`: `_renderStageAssets(r.entered, r.prev)`,
set `state.beat/carrier`, `playThenLoop(glide, loop)`, `onStage(...)`,
`_updateNowPlaying()`, prefetch `r.next`, free `r.release`. All render/transport
lines are lifted verbatim — no logic change, only the *decision* of which stage
now comes from `r` instead of an inline scan.

An optional sugar `Sequencer.drive(now, handlers)` may dispatch the `TickResult`
to `{ onEnter, onFade, onFinish, onProgress }` callbacks for callers who prefer
events; the engine can use either. The canonical, test-facing surface is the
`TickResult` return value.

---

## Part 4 — Behaviour-preservation test plan (the Rigor Gate)

### 4.1 What "identical" means here — and what it can't mean

The rendered **PCM is deliberately non-deterministic**: pink noise
(`render-core.js` L190), TPDF dither (L63), and the 1/f wander (L291–298) all
call `Math.random()`. "Bit-for-bit identical WAV" is therefore *impossible and
not the target*. The audio path is preserved **by construction**: `_playStage`
calls `RenderCore.renderSegment` with the *same arguments* the old `_enterStage`
did — proven by inspection/diff, not by output comparison.

What IS deterministic, and what the Rigor Gate actually pins, is the
**decision stream**: the schedule, and the exact sequence of stage transitions,
fade-arm, and finish events the sequencer emits for a given `now` timeline. If
that stream is identical, the Sleep Processor is behaviourally identical.

### 4.2 Harness

No test infra exists today. Phase 1 adds the minimum: a `package.json` with
`"test": "node --test"` and Node's built-in `node:test` + `node:assert/strict`
(zero dependencies — honours "earn every dependency"). Modules already
dual-export (`module.exports` in `render-core.js` L430); `sequencer.js` and
`programs.js` follow the same pattern so they `require()` cleanly in Node.

### 4.3 The exact Node tests that must pass

**`test/programs.test.js` — golden fixture (the baseline everything rests on)**
- `buildSleepProgram(4, true)` deep-equals a checked-in golden array:
  **2 lead-in (Settling, Descent) + 4×(Delta, REM) + 3 inter-cycle transitions +
  3 wake = 16 stages, Σ 355 min (5h 55m)**, with the exact
  `beat/minutes/carrier/label` from app.js L47–58.
- `buildSleepProgram(1, false)` golden (no wake, no inter-cycle transition).
- Σ minutes matches the duration preview math in app.js L349.
- Guards the pure relocation in Patch 1: the stage *definition* cannot drift.

**`test/schedule.test.js` — pure `buildSchedule`**
- `buildSchedule(buildSleepProgram(4,true), 0)` golden: `startMs` deltas equal
  the cumulative `Σ minutes*60*1000`; each `glideSec == clamp(minutes*60, 2, 45)`
  (reproduces `runProgram` L408–418 and `_enterStage`'s `glideSec` L414).
- `totalSec == Σ minutes*60`. `stages[i].startMs == stages[i-1].endMs`.
- Empty sequence (plain timer) ⇒ `stages:[]`, `totalSec == minutes*60`.

**`test/resolve.test.js` — pure observer**
- `resolve(sched, startMs-1)` ⇒ `stageIndex −1` (or 0-clamped per final decision),
  `elapsed 0`.
- Mid-stage `now` ⇒ correct `stageIndex`, `stageElapsed`, `remaining`.
- **Throttle jump:** a `now` past three stage boundaries ⇒ `stageIndex` = the
  latest passed stage (the forward-scan invariant). This is the exact case
  `_programTick` L504–510 exists for.
- `now ≥ end` ⇒ `atEnd true`, `remaining 0`.
- Idempotence: `resolve(sched, T)` called twice is `deepEqual`.

**`test/sequencer.test.js` — characterization of the decision stream**
- Drive a scripted `now[]` timeline through `Sequencer.tick` and assert the
  emitted `TickResult` sequence:
  - exactly one `entered` per stage, in order;
  - a >1-stage jump emits a single `entered` for the target (no replay);
  - `armFade` fires exactly once, on the first tick with `remaining ≤ fadeOutTail`;
  - `finished` fires once, and never alongside a live `armFade`;
  - `prev/next/release` indices correct at boundaries (`release` null for i<2).
- **Golden-baseline step (characterization-first):** before touching
  `audio-engine.js`, capture the current inline behaviour by driving the *unmodified*
  scheduler through the same timeline (via a thin harness that stubs
  `RenderCore`/transport to record calls) and snapshot the stage-transition +
  fade + finish order. The extracted `Sequencer` must reproduce that snapshot.

**`test/render-core.smoke.test.js` — proves the harness runs real repo code**
- Pin two existing pure helpers so the harness is trusted: `snapLoopSeconds(150, 1.5)`
  returns a whole-cycle value; `applyEdgeFade` zeroes the first sample on `'in'`.

### 4.4 Gate

`node --test` green + `node --check js/*.js` on every touched file. No "extraction
complete" claim until `test/sequencer.test.js`'s golden snapshot matches and the
Sleep Processor has been run once on-device (the existing
`ON-DEVICE-TEST-CHECKLIST.md` row: full program advances stages, fades, ends).

---

## Part 5 — One seam, three features (payoff — NOT built in Phase 1)

The whole point: once "an ordered run = a `Sequence`, driven by one pure
Sequencer," three specced items stop being separate systems and become three
callers of the same seam.

**My States** (V3 Pillar 3) — a saved state is a `StateVector`; playing it is a
one-stage Sequence:
```js
function stateToSequence(name, sv, minutes) {
  return { id: `mystate:${name}`, label: name, fadeOutTail: 8,
           stages: [{ id: 's0', label: name, target: sv, minutes,
                      transition: { kind: 'cut', seconds: 0 } }] };
}
localStorage.setItem('mystates', JSON.stringify([...saved, { name, sv: engine.state }]));
engine.run(stateToSequence('Evening Wind-down', sv, app.sessionMin));
```
No new engine path — `run()` is what the sleep program already uses.

**Glide Engine** (V3 Pillar 2) — every `setParam` while playing becomes a
one-stage glide Sequence chained into the loop; reuses `playThenLoop` 1:1:
```js
setParamGliding(key, value, seconds = 3.5) {
  const target = { ...this.state, [key]: value };
  this.run({ id: 'glide', label: this._nowPlayingTitle(), fadeOutTail: 8,
             stages: [{ id: 'g', label: '', target,
                        minutes: this._sessionRemainingMin(),
                        transition: { kind: 'glide', seconds } }] });
}
```
The transport's `playThenLoop(glideBlob, loopBlob)` — already the mechanism for
sleep-stage glides — needs no change. "Presets retune over ~4 s" falls out.

**Stage-timeline UI** (V3 Pillar 3) — the strip renders `schedule.stages`
directly, with the live marker at `TickResult.elapsed / total`:
```js
engine.onTimeline = sched => renderStrip(sched.stages);      // once, on run()
engine.onTick = remain => marker.style.left = pct(1 - remain / app.sessionTotal);
```
The data (`startMs`, `minutes`, `label`, band colour via `bandFor(beat)`) already
exists inside the schedule — today it's trapped in the private `_program`.

Each is a few lines *because* the substrate is one seam. That is the "ordered
energy leverage": one declarative definition, deterministically driving render +
transport, reused three ways.

---

## Part 6 — Phase 1 implementation order

Strictly: pure extraction + tests first. **Zero new features. No `run()`
unification, no glide, no My States** until the Sleep Processor passes §4 and an
on-device run. Each step is independently landable and guarded by its own test.

| Step | Change | Risk | Gate |
|---|---|---|---|
| **1** | Add `package.json` + `node:test` harness. Extract `buildSleepProgram`/`PRESETS` (pure) from `app.js` → `js/programs.js` (dual-export). Wire `index.html` + `app.js` reference. Ship `test/programs.test.js` golden + `render-core.smoke.test.js`. | **Lowest** — pure relocation of a DOM-free function; establishes the deterministic baseline. | golden green; app boots; sleep preview unchanged |
| **2** | Create `js/sequencer.js`. Extract pure `buildSchedule` from `runProgram` (L408–418) + `_enterStage`'s `glideSec`. `runProgram` calls it. Ship `test/schedule.test.js`. | **Low** — same arithmetic, relocated; still no observer change. | schedule golden green; program still starts |
| **3** | Add pure `resolve` + `Sequencer` shell (`tick`/`load`/`reset`). Rewrite `_schedulerTick`/`_programTick`/`_enterStage`/`_finish` as thin adapters consuming `TickResult`. Ship `resolve.test.js` + `sequencer.test.js` (with the characterization golden). | **Contained** — the only behavioural step; fully pinned by the golden decision-stream snapshot captured *before* the edit. | full suite green; **on-device sleep run** |

After Step 3 the sleep program runs on the extracted Sequencer with an identical
decision stream, and the engine's public API (`startSessionTimer`, `runProgram`,
`onTick/onStage/onEnded`, `stop`) is byte-for-byte unchanged. Only then does the
internal `run(sequence)` unification and Part 5's payoff open — as Phase 2.

---

## Part 7 — Explicit non-goals for this spec

No feedback hooks wired (the interface ships dormant). No `run()` public-API
change. No Glide, My States, or timeline code. No transport or RenderCore edits.
No physics, digital-twin, or magnetic-anything — the systems layer only: ordered
stages, a pure sequencer, closed-loop self-correction, one reusable seam.
