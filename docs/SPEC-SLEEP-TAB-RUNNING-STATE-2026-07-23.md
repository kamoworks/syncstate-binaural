# Spec: Sleep Tab Running State (2026-07-23)

**Status: PROPOSED — awaiting Kamo's greenlight.**

Context: device testing of the Phase-1 build surfaced a UX gap. Starting the
Sleep Processor bounces the user to the Session tab and leaves the Sleep tab
showing its config screen, so it reads as "nothing happened" even though the
program is running correctly. This spec diagnoses it and specs a surgical fix.

**This is NOT a Phase-1 regression.** The Sequencer extraction is behaviour-
preserving (17-test decision-stream golden + the on-device run confirming stages
advance). The cause is pre-existing app.js/index.html UI code untouched by Phase
1. The fix is isolated to `js/app.js` + `index.html` (+ a little CSS) — **no
engine or Sequencer change**.

---

## Part 1 — Diagnosis (exact paths)

### Symptom (device, iOS Safari)
1. Sleep tab → tap **Begin Sleep Program** → the app jumps to the **Session**
   tab, which correctly shows the running program ("Settling · Alpha", 353:50,
   Alpha chip, live dial).
2. Return to the **Sleep** tab → it shows the original config UI (cycles select,
   wake toggle, "Begin Sleep Program", cycle map) with **no indication a program
   is running** and **no way to stop it from here**.

### Root cause — two independent facts
| # | Fact | Location |
|---|---|---|
| A | `startSleep` force-switches to Session after `runProgram` | `initSleepUI` → `showTab('session')` at [app.js:311](../js/app.js) |
| B | The Sleep panel is **static HTML with no running state** — `showTab` only toggles panel visibility, never panel *content* | `#tab-sleep` [index.html:155-199](../index.html); `showTab` [app.js:327](../js/app.js) |
| C | The running program's live display + transport are bound to **Session-tab** DOM (`#nowPlaying`, `#timerReadout`, `#bandChip`, `#playBtn`) | `updateStageUI` [app.js:100](../js/app.js), `onTick` [app.js:114](../js/app.js) |

A takes you away from Sleep; B means Sleep can never show "running"; C means the
only live surface is Session. Together: the launcher tab looks inert and the
controls feel exiled.

### Regression check (Rigor Gate)
`showTab('session')` and the static Sleep panel are present in the pre-Phase-1
code (verified against the turn-1 read of `app.js` and the current `index.html`).
Phase 1 changed only the scheduler internals + the pure program-library move.
**Confirmed pre-existing.**

---

## Part 2 — The fix

Give the Sleep tab its own **running state**, and stop bouncing the user away
from it. The Session tab remains the universal now-playing surface (unchanged);
the Sleep tab becomes self-contained for the one thing it launches.

### 2.1 Navigation decision (the one design fork)

**Recommended: remove the forced `showTab('session')`; stay on the Sleep tab,
now in running mode.** Rationale:
- It fixes both complaints directly: the launcher tab shows its own program
  running, with its own Stop control.
- During a program, the Session tab's frequency sliders are largely inert
  anyway (`_scheduleRebuild` early-returns for programs — stage renders own the
  audio), so dumping the user there surfaces controls that don't do much.
- The big dial stays one tap away on Session for anyone who wants it.

*Alternative (lighter, if preferred):* keep the jump to Session, but still add
the running state so returning to Sleep shows the program. Fixes complaint 1
only. Flagged for greenlight; the spec below assumes the recommended option.

### 2.2 DOM model (`index.html`, `#tab-sleep`)

Wrap the existing config markup in `#sleepConfig`; add a sibling `#sleepRunning`
(hidden by default). The Cycle-map card stays outside both (always visible; it
gains a live position marker in running mode).

```html
<section class="tab-panel" id="tab-sleep">
  <div id="sleepConfig">
    <!-- existing: .sleep-hero, Program card, #sleepDuration, #startSleep -->
  </div>

  <div id="sleepRunning" hidden>
    <div class="sr-head">
      <div class="sr-stage" id="srStage">Settling · Alpha</div>
      <div class="sr-remaining" id="srRemaining">5:53:50</div>
    </div>
    <div class="sr-bar"><div class="sr-bar-fill" id="srFill"></div></div>
    <div class="sr-meta" id="srMeta">Stage 1 of 16</div>
    <button class="cta cta-stop" id="stopSleep">Stop Program</button>
  </div>

  <div class="card"><!-- Cycle map (always visible); add #cycleMarker overlay --></div>
</section>
```

### 2.3 JS (`js/app.js`) — all from existing state, no new engine API

```js
// single toggle: config vs running, driven by app.program
function updateSleepView() {
  const running = !!app.program;
  $('#sleepConfig').hidden = running;
  $('#sleepRunning').hidden = !running;
}

// live running-view refresh (stage + progress) from data app.js already tracks
function refreshSleepRunning(stage, remain) {
  if (!app.program) return;
  const st = stage || app.programStage;
  if (st) {
    const band = bandFor(st.beat);
    $('#srStage').textContent = st.label;
    $('#srStage').style.color = band.color;
    $('#srMeta').textContent = `Stage ${st.index + 1} of ${app.program.length}`;
  }
  if (remain != null && app.sessionTotal) {
    $('#srRemaining').textContent = fmtClock(remain);            // H:MM:SS
    $('#srFill').style.width = `${(1 - remain / app.sessionTotal) * 100}%`;
    $('#cycleMarker').style.left = `${(1 - remain / app.sessionTotal) * 100}%`;
  }
}
```

`fmtClock(remain)` is a small pure helper (H:MM:SS for multi-hour programs; the
existing `onTick` formatter is MM:SS only). It is the one unit-testable piece
(see Part 4).

### 2.4 Wiring (surgical additions)

| Hook | Change |
|---|---|
| `initSleepUI` startSleep | replace `showTab('session')` → `updateSleepView()` |
| new `stopSleep` handler | mirror the dial's stop branch: `engine.stop(3); app.playing=false; app.program=null; updatePlayUI(); updateStageUI(null); updateSleepView();` |
| `engine.onStage` | after `updateStageUI(stage)` → `refreshSleepRunning(stage, null)` |
| `engine.onTick` | after the existing dial update → `refreshSleepRunning(null, remain)` |
| `engine.onEnded` | after existing resets → `updateSleepView()` |
| `togglePlay` stop branch | after existing resets → `updateSleepView()` |
| boot (`DOMContentLoaded`) | call `updateSleepView()` once (shows config; programs never persist across reload) |

No changes to `showTab`, the Session tab, presets, plain sessions, affirmations,
or the engine.

---

## Part 3 — Behaviour preservation

- **Session tab now-playing** unchanged — presets and plain sessions behave
  exactly as before (they never set `app.program`, so `updateSleepView` keeps
  `#sleepConfig` visible and never shows the running block).
- **Engine / Sequencer** untouched — zero risk to the Phase-1 gains.
- **Stop parity** — the new Stop button and the Session dial both route through
  the same `engine.stop(3)` + state reset, so there is one stop path, two
  entry points.
- The only observable change is intended: after Begin, you stay on Sleep in a
  running view instead of jumping to Session.

---

## Part 4 — Verification

- **Pure/Node:** add `test/clock.test.js` pinning `fmtClock` (e.g. `0→"0:00"`,
  `59→"0:59"`, `3600→"1:00:00"`, `21230→"5:53:50"`). Keeps the harness habit;
  it's the only branchy logic in the fix.
- **On-device (Kamo's gate):**
  1. Begin Sleep Program → **stay on Sleep**, running view shows current stage,
     remaining time counting down, progress bar advancing, "Stage 1 of 16".
  2. Switch to Session → dial + now-playing still correct; switch back to Sleep →
     still running (not reset to config).
  3. Tap **Stop Program** → returns to config; audio fades and stops.
  4. Let a stage boundary pass → Sleep running view's stage label + "Stage N of
     16" update (mirrors the lock screen).
  5. Presets / plain timer / affirmations unaffected; Session tab unchanged.
- `node --check` touched JS; full suite (now 18 tests) green.

---

## Part 5 — Non-goals

- **Not** the full V3 Pillar-3 stage-timeline strip (each of the 16 stages as a
  segment with per-stage marker). This running view is the minimal, correct
  fix; the rich strip — reading `schedule.stages` straight off the Sequencer via
  a small `engine.getProgram()` accessor — is the natural Phase-2 evolution and
  the payoff the Sequencer extraction set up.
- No engine/Sequencer changes. No new persistence. No pause/resume on the Sleep
  view beyond Stop (sleep programs are start/stop in practice; the Session dial
  still offers pause).
