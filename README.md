# SyncState — Binaural Consciousness Studio

A mobile-first (iPhone-optimized) web app for inducing desired states of consciousness with
binaural beats, implementing the audio methods of **US Patent 5,356,368** — Robert A. Monroe's
*"Method of and Apparatus for Inducing Desired States of Consciousness"* (1994, expired, public domain).

## Run it

It's a fully static app — no build step:

- Open `index.html` from any static web server (audio requires http(s) or localhost on some browsers).
- On iPhone: open the hosted URL in Safari → Share → **Add to Home Screen** for full-screen app mode.
- **Stereo headphones are required** — binaural beats need a separate tone in each ear.

## Features

### Audio engine (patent-faithful)
- **Binaural FFR pairs** — two detuned sine oscillators routed hard left/right via `ChannelMergerNode`; the brain constructs the phantom beat at the difference frequency (e.g. 200 Hz L / 204 Hz R → 4 Hz beat).
- **Septōn multi-beat mode** — simultaneous binaural beat + harmonic binaural pair (2×) + monaural amplitude modulation within each ear, per the patent's multi-signal "Septon" concept.
- **Phased pink-noise bed** — decorrelated stereo pink noise (Paul Kellet filter) for masking, per the patent's pink-sound layer.
- **Smooth glides** — all frequency transitions use scheduled linear ramps; gain uses setTargetAtTime smoothing (no clicks).

### States (Mood Minder embodiment)
One-tap presets: Deep Sleep (Delta 2 Hz), Meditation (Theta 6 Hz), Relaxation (Alpha 10 Hz),
Concentration (SMR 12 Hz + septon), Focus (Beta 16 Hz), Peak Awareness (Gamma 40 Hz).

### Sleep Processor (primary patent embodiment)
Programmable 90-minute sleep-cycle program: Alpha descent → Theta → Delta deep sleep →
Theta REM, repeating, plus an optional wake-up ramp (Theta → Alpha → Beta). 1–6 cycles.

### Calibration controls
- Beat frequency (log-scale slider, 0.5–45 Hz) with live band readout
- Carrier tone (80–500 Hz)
- Master volume, tone level, pink-noise level, ear balance
- Session timer (10–60 min) with automatic fade-out
- Settings persisted in localStorage

### Visualization
Canvas renderer showing the left/right ear waveforms, the perceived beat envelope,
a live spectrum (from the Web Audio analyser), and a log-scale Delta→Gamma band marker.

## iOS notes
- `AudioContext` is created/resumed inside user gestures (required by Safari autoplay policy).
- Resumes automatically when returning from background.
- Safe-area insets, `apple-mobile-web-app-capable`, and no-overscroll are handled.

## Safety
Never use while driving. Not a medical device. If you have epilepsy or a seizure disorder,
consult a physician first.

## Tech
Vanilla JS + Web Audio API + Canvas. No dependencies, no build step.

## Files
```
index.html          app shell + all screens
css/style.css       mobile-first dark UI
js/audio-engine.js  binaural/septon/noise engine + programs
js/visualizer.js    waveform + spectrum + band visualization
js/app.js           UI logic, presets, sleep program
manifest.json       PWA manifest
```

Patent: US 5,356,368 · R. A. Monroe · filed 1991, issued 1994 · expired — public domain.
Binaural beats discovered by Heinrich Wilhelm Dove, 1839.
