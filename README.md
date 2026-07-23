# SyncState — Binaural Consciousness Studio

A mobile-first (iPhone-optimized) web app for inducing desired states of consciousness,
implementing **three expired, public-domain US patents** as one layered audio system:

| Patent | Inventor | Layer |
|---|---|---|
| **US 5,356,368** (1994) | Monroe | Binaural FFR entrainment, Septōn, Sleep Processor |
| **US 5,954,630** (1999) | Masaki/Hayashibara | Fm theta AM focus tone + 1/f fluctuation |
| **US 5,245,666** (1993) | Mikell | Dynamically masked subliminal affirmations |

## Run it

Fully static — no build step:

- **Live:** https://kamoworks.github.io/syncstate-binaural/
- On iPhone: open in Safari → Share → **Add to Home Screen** for full-screen app mode.
- **Stereo headphones required for binaural beats.** The Masaki Focus Tone works on speakers.

## Features

### Layer 1 — Binaural engine (US 5,356,368)
- Detuned sine pairs routed hard left/right; brain constructs the phantom beat
- **Septōn mode**: binaural + harmonic (2×) pair + monaural AM per ear
- **Phased pink-noise bed** (decorrelated stereo, Paul Kellet filter)
- **Sleep Processor**: 90-min cycles (Alpha→Theta→Delta→REM), wake-up ramp, 1–6 cycles
- **Mood Minder presets**: Deep Sleep, Meditation, Relaxation, Concentration, Focus, Peak Awareness

### Layer 2 — Masaki Focus Tone (US 5,954,630)
- 120–200 Hz carrier (150 Hz optimum) amplitude-modulated at **2–10 Hz** (6.5 Hz Fm theta sweet spot)
- Depth 30–100% (**80% = tested optimum**)
- **1/f fluctuation**: organic bio-rhythm wander of rate/depth — augments induction
- Works through speakers — desk/study mode without headphones

### Layer 3 — Affirmations (US 5,245,666)
- **Voice recording** on-device (MediaRecorder → loop) — the patent's primary mode
- **Transparent library** (Calm, Focus, Confidence, Sleep) — full text always shown
- **Dynamic masking engine**: envelope follower on the cover mix, 20 ms attack,
  adaptive 60–150 ms release exploiting **post-masking**; message tracks the cover
  so it stays at the edge of hearing
- **Liminal calibration slider** + live cover/message meters

### Background playback (like a music app)
- Audio is rendered offline into seamless WAV loops and played through a media
  element — the one path iOS keeps alive when the screen locks or you switch apps
- Lock-screen / Control Center play-pause via the Media Session API
- Sleep Processor stages advance on a wall-clock schedule that survives backgrounding
- Most reliable in a Safari tab. The Home Screen app works on most iOS versions,
  but Apple has an open regression (iOS 26.0.x) that can break background audio in
  installed web apps — if affected, use the site in Safari.
- Architecture + primary-source research: `docs/SPEC-BACKGROUND-PLAYBACK-2026-07-23.md`

### UX
- Guided first-run tour with spotlights (replay anytime via the **?** button)
- 18 contextual info popups (bottom sheets) on every control
- Session timer with auto fade-out, settings persistence, PWA installable

## Files
```
index.html                    app shell + all screens
css/style.css                 mobile-first dark UI
js/render-core.js             offline DSP renderer (seamless loops, WAV, FFT)
js/playback.js                media transport (<audio> element + Media Session)
js/audio-engine.js            3-patent engine facade (renders, schedules, plays)
js/visualizer.js              waveform + spectrum + band visualization
js/app.js                     UI logic, presets, sleep program, focus controls
js/affirmations.js            recording, library, masking meters
js/help.js                    guided tour + info popups
assets/affirmations/*.b64     affirmation loops (base64, decoded on-device)
manifest.json                 PWA manifest
```

## Safety
Never use while driving. Not a medical device. If you have epilepsy or a seizure
disorder, consult a physician first. Affirmations are a mindfulness/self-suggestion
tool — the app makes no hidden-messaging claims and always shows full text.

Patents: US 5,356,368 · US 5,954,630 · US 5,245,666 — all expired, public domain.
Binaural beats discovered by Heinrich Wilhelm Dove, 1839.
