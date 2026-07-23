# Research: iOS Mic Capture vs Audio Session, MediaRecorder, Permissions (2026-07-23)

> For SPEC-AFFIRM-STUDIO. The load-bearing question: why does getUserMedia fail
> with no prompt while `navigator.audioSession.type = 'playback'` is set?

## 1. Audio Session type vs getUserMedia — ROOT CAUSE CONFIRMED

- **VERIFIED (W3C draft spec):** the microphone-track update steps state: "If
  audioSession.type is not `play-and-record` or `auto`, end track." With
  `type='playback'` the mic track is **ended** — no specific rejection error is
  defined; the failure mode is a dead track / silent failure rather than a
  documented exception (which matches the no-prompt symptom).
- **VERIFIED (caniuse/BCD):** `navigator.audioSession.type` shipped Safari
  16.4+ (desktop + iOS) through 26.x; Safari is the only engine.
  `'play-and-record'` is the correct type for mic use (MDN's own example sets
  it before getUserMedia). `'auto'` (default) lets the UA pick per activity.
- **Dynamic switching — VERIFIED in spec:** runtime assignment is defined;
  exclusive types (playback, play-and-record, transient-solo) can inactivate
  other sessions. What happens to a playing <audio> on playback→play-and-record
  is unspecified; anecdotally playback continues but rerouted/ducked into
  voice-processing mode.

## 2. getUserMedia while audio plays

Widely reported, semi-verified: mic activation flips AVAudioSession into
play-and-record with voice processing → output forced from Bluetooth/wired to
built-in speaker (WebKit bug 196539), "phone-call quality" ducking, and
low/quiet output that can **persist after tracks stop** (Apple forums: iOS 15
WebRTC volume ~2/3, low output after gUM). Fixes (anecdotal, aligned with the
API's purpose): set `'play-and-record'` BEFORE getUserMedia, restore
`'playback'` after `track.stop()`; reassign src and replay if still degraded.
`setSinkId()` unusable on iOS.

**Design consequence: pause the session during capture** (avoids rerouted/
ducked listening AND mic bleed), restore the type + resume after.

## 3. MediaRecorder on iOS Safari

- **VERIFIED:** records `audio/mp4` (AAC); MediaRecorder since iOS 14.5-era;
  `audio/wav` dropped ~14.1; STP 214 added ALAC/PCM. Feature-detect via
  `MediaRecorder.isTypeSupported()`; audio/mp4 is the iOS target (Chrome/FF
  give webm/Opus — handle both).
- Anecdotal quirks: `dataavailable` with timeslice fires irregularly on iOS;
  sub-1 s recordings can be empty/corrupt; **assemble the file in `onstop`**.
  iOS 26.1 beta had a gUM failure bug ("No AVAudioSessionCaptureDevice",
  forums 802555) — Kamo is on 26.3.1.
- **echoCancellation:** with headphones there's no echo path, but AEC engages
  the voice processing that degrades other audio. Request
  `echoCancellation:false, noiseSuppression:false` with plain-`{audio:true}`
  fallback; support inconsistent (anecdotal).

## 4. Standalone (Add to Home Screen) PWA

- gUM-broken-in-standalone was WebKit 185448, fixed iOS 13.4 (historical).
- Current: permissions are **not persisted** in standalone like a Safari-tab
  Allow — reports of re-prompts per launch (iOS 18.5 era); WebKit 215884:
  hash-change navigation destroys the media environment → repeat prompts.
  Plan for a prompt per app launch; avoid hash routing around recording (we
  use none).

## 5. Permission UX facts

**VERIFIED (MDN):** prompt only on the getUserMedia call, never at load; the
promise may neither resolve nor reject if the user ignores the prompt; a
denied state rejects **immediately with NotAllowedError, no prompt**. Safari
per-site aA → Website Settings → Microphone: Ask/Allow/Deny; default Ask
re-prompts per session; HTTPS required (`mediaDevices` undefined otherwise).

## Sources

W3C audio-session spec + explainer; MDN AudioSession.type + getUserMedia;
caniuse; WebKit blog 11353 (MediaRecorder); WebKit bugs 196539, 215884,
185448; Apple forums 802555, 691647; addpipe gUM/ALAC guides; Medium
speaker-forcing writeup.
