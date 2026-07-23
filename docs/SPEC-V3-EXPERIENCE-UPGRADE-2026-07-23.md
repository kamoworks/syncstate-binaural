# Spec V3: The Experience Upgrade (2026-07-23)

**Status: COMPLETE — awaiting Kamo's greenlight on phasing.**

Context: v2 achieved the core goal (background playback with lock-screen
controls, confirmed on iPhone 13 / iOS 26.3.1). Device round 2 surfaced the
remaining gaps. This spec covers: full diagnosis of every reported issue, the
audio-seamlessness and quality upgrades, and the UI/UX evolution.

## Part 1 — Diagnosis of device-test round 2 (from code, exact paths)

### A. "One cut ~10 s after leaving the app" + B. "Cut on every audio tap" — same root

Every audio-affecting tap runs `setParam → _scheduleRebuild → _rebuild →
transport.playLoop(newBlob, position)` (audio-engine.js), which is a **hard src
swap on the playing element**: ~100–300 ms of silence. Call sites that cut today:

| Interaction | Path |
|---|---|
| Any slider (beat, carrier, tone, noise, balance, volume, FM rate/depth/carrier, aff ratio) | `bindSlider → setParam` |
| Septōn / Focus Tone / 1/f toggles | `setParam` |
| Preset tap while playing | `applyPreset → setParam ×4` (one debounced rebuild) |
| Affirmation card click / enable toggle | `loadAffirmation` / `setAffirmationOn → _scheduleRebuild` |

The ~10 s background cut is the **intro→loop handoff**: the fade-in intro
one-shot is 12 s long (`introSec = min(12, dur)`); its handoff relies on a
`setTimeout` armed from `timeupdate`, which iOS throttles in the background, so
the `ended`-event backstop fires with a brief gap. Leave the app during the
intro and the cut lands ~10 s later. After that, wraps are 150 s apart and the
same degradation is rare enough that playback sounded clean.

**Fix direction (both):** route *every* transition through the v2 ping-pong
handoff instead of hard swaps — `_rebuild` should prep the standby element with
the new render and hand off with the ~150 ms overlap (new
`transport.transitionLoop(blob, position)`), and the intro should be a
**full-loop-length** faded copy so its handoff happens at the 150 s seam with
the standard machinery, not at 12 s. Additionally, fire handoffs directly from
the `timeupdate` handler when remaining < ~0.5 s rather than trusting
`setTimeout` in the background.

### C. Lock screen stuck at "0:00 / 2:30"

2:30 is the 150 s loop duration leaking into Now Playing: iOS reads
`el.duration` from whichever element it latched onto, and we never call
`navigator.mediaSession.setPositionState()`. After ping-pong handoffs the
timeline freezes (iOS's target element paused/reset). **Fix direction:** feed
`setPositionState` explicitly — duration = the *session* length (timer or
program total), position = elapsed session time, refreshed on tick and after
every handoff/src change. Endless presentation (no fake track bar) pending
agent verification of iOS behavior with Infinity/omitted duration.

### D. Affirmation UX trap

In affirmations.js, a library card click can only *select* (load + enable +
auto-start cover). There is no deselect: clicking the active card reloads it;
toggling Enable off silences but keeps `_affBuffer`, so re-enabling resumes.
Nothing in the UI fully clears the channel (user resorted to page refresh).

**Fix direction:** clicking the active card deselects it (new
`engine.clearAffirmation()`: clears `_affBuffer`, turns `affOn` off, rebuilds
seamlessly); active card shows a ✕/"tap to stop" affordance; status line says
what will happen. With seamless transitions (fix A/B) these interactions also
stop *cutting* the audio, which was half the perceived brokenness. A "refresh
audio" button is rejected as a band-aid; proper stop semantics remove the need.

### E. Volume model (quality + interaction cost)

`state.volume` is baked into every render, so volume nudges cost a full
re-render, and low volumes waste 16-bit headroom (quiet sine content quantizes
audibly — correlated harmonic distortion, worst exactly in this app's quiet
meditation use case).

**Fix direction:**
- Add **TPDF dither** at ±1 LSB in `encodeWav` — cheap, correct, and a real
  audible improvement for low-level tonal content regardless of other choices.
- Apply volume live via `element.volume` where the platform honors it
  (desktop/Android; feature-detected). iOS ignores `element.volume` by design →
  volume stays baked there (debounced, but now via seamless transition), and
  the slider hints that hardware buttons control loudness while locked.

## Part 2 — Research inputs (complete)

- `RESEARCH-MEDIASESSION-BACKGROUND-2026-07-23.md`: setPositionState is
  iOS 15+; duration required (Infinity legal, iOS rendering unverified); no
  polling — re-call after every src swap/handoff; the ~10 s blip has no exact
  public match and is best explained by the process-suspension handshake
  (mitigations: Media Session registered before first play, fully buffered
  blobs, idle JS at the transition); ping-pong risks Now Playing target
  re-election (re-anchor after each handoff) but is empirically clean on the
  target device; drive swaps from timeupdate/ended, never setTimeout alone.
- `RESEARCH-COMPETITIVE-UX-2026-07-23.md`: presets-first wins the category;
  live gliding controls exist NOWHERE mainstream (differentiator); BetterSleep
  layer-mixing and myNoise animate-mode are the layering benchmarks; premium
  visual norm is dark + slow sound-reactive generative animation; biggest
  complaint gaps: subscription dark patterns, online-only generation, broken
  timers; biggest web win: full offline (we generate locally).

## Part 3 — The V3 plan

### Pillar 1 — Zero-cut audio core (the fix round)

1. **`transport.transitionLoop(blob, position)`**: `_rebuild` swaps via the
   standby element with the ~150 ms overlap handoff instead of a hard src swap.
   Kills every tap cut (sliders, toggles, presets, affirmations).
2. **Full-length intro**: the fade-in one-shot becomes a full-loop-length
   envelope copy, so its handoff rides the standard 150 s seam machinery.
   Removes the ~10 s-after-leaving cut from our side entirely.
3. **Handoff triggering**: primary trigger fires directly inside `timeupdate`
   when remaining < ~0.5 s; foreground `setTimeout` only as a precision assist;
   `ended` stays as backstop (per research: never trust setTimeout arithmetic
   in background).
4. **Media Session discipline**: metadata + handlers registered before first
   play; `setPositionState({duration: sessionTotal, position: elapsed,
   playbackRate: 1})` on play/pause and after EVERY src change/handoff (with
   `isFinite` guard). Lock screen then shows true session progress — fixes the
   stuck "0:00 / 2:30".
5. **Affirmation stop semantics**: `engine.clearAffirmation()`; tapping the
   active card deselects (✕ affordance + status copy); enable toggle unchanged
   as master switch. All applied via seamless transition.
6. **Quality floor**: TPDF dither (±1 LSB) in `encodeWav`; `element.volume`
   live where the platform honors it (feature-detected), baked-and-seamless on
   iOS with a "hardware buttons control loudness" hint in the volume info sheet.

### Pillar 2 — The Glide Engine (category differentiator)

Every parameter change becomes a rendered **glide**: a 3–4 s segment sweeping
current → target (beat, carrier, mix, FM), chained into the new loop via
`playThenLoop`. Presets while playing "retune" over ~4 s. Research found no
mainstream app with live morphing controls — brainaural (the pro-control
reference) is abrupt. This reuses the sleep-stage machinery 1:1 and doubles as
total masking of any residual transition artifact. UI mirrors it: readouts
animate to the new value during the glide.

### Pillar 3 — Session & lock-screen experience

- Lock screen = session progress (Pillar 1.4), band title, tinted artwork.
- Sleep tab: **stage timeline strip** (schedule data already exists) with a
  live position marker; current stage highlighted.
- "Preparing audio…" text replaced by a shimmer/pulse state on the play dial.
- **My States**: save current settings as a named custom preset (localStorage),
  listed above the built-ins in States. Table stakes per research (favorites
  are universal); trivially cheap here.

### Pillar 4 — Procedural soundscape beds (scoped)

Replace the single pink-noise bed with a **bed picker**: Pink noise · Brown
noise · Rain · Ocean · Wind, all procedurally rendered offline (filtered noise
+ slow LFO envelopes + transient sprinkles for rain), one bed at a time + level
slider. Deliberately NOT a 9-layer mixer (BetterSleep's lane) — myNoise-style
focused quality. The most-demanded beds per reviews are rain and ocean.
"Animate" (slow bed drift) rides the existing 1/f concept — Later.

### Pillar 5 — Visual pass (premium norm)

**Breathing orb** behind the play dial: slow generative radial animation
pulsing at the actual beat frequency (wide/slow for Delta, tight/fast for
Beta), band-tinted, deliberately calm. Per research this alone puts SyncState
visually above every dedicated entrainment app (BrainWave/brainaural are
dated). Existing Visualize tab stays. No layout redesign (holographic glass
aesthetic is recent and stays).

### Pillar 6 — Offline PWA

Add a version-stamped service worker (cache-first app shell, update-on-reload)
— audio is generated locally, so SyncState becomes FULLY offline, the single
biggest web-app advantage vs streaming competitors (Brain.fm/Endel are
online-bound). Production-only per workspace rule (no SW in dev). Home-screen
mode re-test on iOS 26.3.1 (past the 26.0.x regression).

### Explicit non-goals

Accounts, subscriptions, streaks/gamification, multi-layer mixers, native
wrappers. The complaint-gap positioning is: free, offline, no dark patterns.

### Phasing

| Phase | Scope | Size |
|---|---|---|
| **1 — Fix round** | Pillar 1 complete (all 6 items) | Small, ship first, device-verify |
| **2 — Feel** | Glide Engine + My States + stage timeline + dial shimmer | Medium |
| **3 — World** | Soundscape beds + breathing orb + service worker | Medium |

Each phase ends with the on-device checklist (updated per phase) before the
next begins.

## Part 4 — Verification

Per phase: `node --check` all JS; extend the Node harness (dither
distribution test, glide schedule builder, bed generators' spectral sanity);
on-device checklist rows for: no cut on any tap, no cut after backgrounding,
lock-screen session progress advancing, affirmation deselect, bed switching,
orb behavior. No "fixed" claims before Kamo's device pass.
