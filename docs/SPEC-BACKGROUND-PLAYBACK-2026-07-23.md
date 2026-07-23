# Spec: Background Playback Rebuild (2026-07-23)

**Goal:** SyncState keeps playing when the iPhone screen locks or the user switches
apps — like Apple Music — with lock-screen play/pause controls.

**Research foundation (read first):**
- `RESEARCH-IOS-BACKGROUND-AUDIO-2026-07-23.md` — platform behavior, primary sources
- `RESEARCH-BACKGROUND-TECHNIQUES-2026-07-23.md` — technique comparison, practitioner convergence

## The verdict from research

1. iOS suspends every Web Audio `AudioContext` on screen lock / backgrounding
   (WebKit bugs 124348, 237878, 261554). The current engine is 100% live Web Audio
   → dies on lock. JS timers freeze too → Sleep Processor stages would stall even
   if audio survived.
2. The ONLY robust background path is an HTML `<audio>` element playing real media
   (file/blob), plus the Media Session API for lock-screen controls.
3. `MediaStreamAudioDestinationNode` bridging is a dead end on iOS (WebAudio spec
   issues #1722/#2293; the source context suspends anyway).
4. A 90-minute single render is impossible (~1.9 GB Float32). Content is periodic
   → render short loops offline, loop the element natively.
5. Standalone (Add to Home Screen) mode is strictly worse than a Safari tab and has
   an open iOS 26.0.x regression. We support both but document Safari tab as the
   reliable surface.

## Architecture: media-element-first

The `<audio>` element is the ONLY sound path during a session. Web Audio is used
for offline rendering and decoding only — never for live output. No dual-path
foreground/background swapping (a swap at the lock transition is exactly where iOS
is tearing the page down; zero moving parts during lock is the design goal —
the steady state overnight is native `loop=true` playback needing no JS at all).

### New file: `js/render-core.js`
- `RenderCore.renderSegment(state, opts)` → `AudioBuffer`. Rebuilds the existing
  DSP graph (binaural pair, Septōn harmonic pair + monaural AM, decorrelated pink
  noise, Masaki AM channel, affirmation channel) on an `OfflineAudioContext`.
  `opts`: `{ seconds, loop, glideFrom, fadeInSec, fadeOutSec, affBuffer }`.
- Loop seam: render `seconds + 0.25`, equal-power-crossfade the tail into the head
  → seamless loop regardless of carrier phase or noise content (research: iOS
  `<audio loop>` is not gapless for arbitrary content; baked crossfade + WAV
  minimizes the seam; loop duration also snapped to whole beat cycles so the beat
  envelope is continuous across the seam).
- 1/f fluctuation: deterministic wander waypoints scheduled across the segment,
  returning to base value at the end (loop-periodic).
- Affirmation masking: two-pass. A short low-rate cover-only pre-render measures
  steady-state cover RMS → the patent gain law `affRatio * (0.2 + env * 1.6)` is
  baked as a constant gain (the live cover is statistically stationary, so the
  realtime envelope follower's output is near-constant anyway).
- `RenderCore.encodeWav(buffer)` → 16-bit PCM WAV `Blob` (20 s stereo ≈ 3.5 MB).

### New file: `js/playback.js`
- `MediaTransport`: owns one hidden `<audio preload="auto">` element.
  - `unlock()` inside the first user gesture: play a ~0.1 s silent WAV data URI
    (blesses the element so later programmatic `.play()` calls are allowed).
  - `playLoop(blob)`, `playOnce(blob, onEnded)` ('ended' chaining — the standard
    iOS playlist pattern, works in background Safari), `pause()`, `resume()`, `stop()`.
  - Blob URL lifecycle (revoke on swap).
  - Media Session: metadata (title = preset/stage, artist "SyncState",
    canvas-generated 512×512 artwork tinted to the active band), handlers for
    play/pause/stop; `navigator.audioSession.type = 'playback'` where available.
  - Watchdog: on `visibilitychange → visible`, if a session should be playing but
    the element is paused (iOS interruption), resume.

### Rewritten internals: `js/audio-engine.js`
`BinauralEngine` keeps its public API so `app.js` / `affirmations.js` /
`visualizer.js` barely change: `state`, `setParam`, `setFmRate`, `setOneDivF`,
`setAffirmationOn`, `loadAffirmation` (+ `_affBuffer` field name), `getMeters`,
`getAnalyser`, `start`, `stop`, `startSessionTimer`, `runProgram`,
`onTick/onStage/onEnded`, `running`, `paused`. New: `onStatus` (render progress),
`recoverPlayback()`.

- `start()`: unlock → render intro segment (2.5 s fade-in baked, one-shot) →
  'ended' → chain to the seamless loop.
- `setParam()`: mutate state; if playing, debounce 350 ms → re-render → swap src
  at the equivalent position. Tradeoff (accepted): slider changes now apply after
  ~0.3–1.5 s with a brief transition blip instead of instantly. This is the price
  of background reliability; every parameter (including volume — iOS ignores
  `element.volume`) is baked into the render.
- Session timer: wall-clock (`Date.now()`) checked from `timeupdate` + a 1 s
  interval; at T−8 s swap to a baked 8 s fade-out one-shot → `ended` → stop.
- `runProgram(stages)`: absolute wall-clock schedule. Per stage: a glide one-shot
  (beat/carrier ramp from the previous stage, ≤45 s) chained into that stage's
  loop. Assets for stage k+1 render lazily during stage k. Transitions fire from
  the `timeupdate` scheduler. Degradation mode: if iOS ever withholds JS at a
  boundary, the current stage's loop simply continues (longer Delta, never
  silence); the watchdog resyncs the schedule on wake.
- Visualizer: `getAnalyser()` returns a shim implementing
  `getByteFrequencyData(u8)` via a small radix-2 FFT (Hann window, AnalyserNode's
  −100/−30 dB byte mapping) over the rendered loop PCM at `element.currentTime`.
  The spectrum shown is the real rendered audio.
- A tiny `AudioContext` is retained ONLY for `decodeAudioData` (affirmation
  recordings/library). It is never connected to the destination.

### UI wiring
- `app.js`: `initIOS()` becomes a `recoverPlayback()` call; "Preparing audio…"
  status while the first render runs. Everything else untouched.
- `index.html`: two new script tags; a "keeps playing when locked" hint line with
  an info button in the Session tab.
- `help.js`: new `background` info sheet — states plainly: best in Safari tab;
  home-screen app works on most iOS versions but Apple has an open bug in iOS
  26.0.x; force-quitting stops audio (true for any app); lock-screen controls
  available.
- `README.md`: new Background Playback section.

## What is deliberately NOT built

- No MediaStreamDestination bridge, no MSE/ManagedMediaSource, no silent-keepalive
  hacks (all researched dead ends — see research doc 2).
- No live Web Audio "preview path" in the foreground: one audio path, no
  compensating swap layers (Rigor Gate).

## Verification

- Local (this machine): `node --check` on all JS; Node harness for the pure parts —
  WAV encoder round-trip, FFT peak-bin correctness, loop-snap math, program
  schedule builder. The OfflineAudioContext graph itself is browser-only and is a
  direct port of the proven live graph.
- Behavioral (Kamo's iPhone, the real environment): on-device checklist — lock
  screen during a preset, app switch, lock-screen controls, overnight Sleep
  Processor stage advance, silent-switch behavior, Safari tab vs home-screen app.
  No "fixed" claim until this passes on-device.
