# Research: Techniques for Background-Surviving Generated Audio on iOS (2026-07-23)

> Agent 2 of 2 for the SyncState background-playback feature. Question: which
> techniques actually keep procedurally generated (Web Audio) sound playing on iOS
> with the screen locked or the app switched, and what did practitioners converge on?
> VERIFIED = primary source; ANECDOTAL = forum/blog reports.

## The hard constraint (VERIFIED)

iOS Safari suspends `AudioContext` the moment the screen locks or Safari is
backgrounded. Confirmed in Apple dev forum threads and
[Tone.js issue #235](https://github.com/Tonejs/Tone.js/issues/235) ("Audio stops on
iOS screen lock"). No Web Audio graph runs while locked. Only HTML media element
playback counts as "media" and keeps running. Force-quitting Safari/the PWA kills
everything, always (standard platform behavior, no exceptions found).

## 1. Pre-render with OfflineAudioContext → blob → `<audio loop>` — THE WINNER

- A plain `<audio>` element playing a file/blob continues through screen lock and
  app switching in a Safari tab, and Media Session API gives lock-screen controls
  (VERIFIED: MDN, W3C, progressier/whatpwacando demos; dbushell.com tested
  on-device, artwork quirks fixed by iOS 18).
- **Gapless looping is the weak spot (VERIFIED):** `<audio loop>` is not
  sample-accurate on iOS; iOS 17+ has a documented loop-click regression even
  natively ([just_audio #1151](https://github.com/ryanheise/just_audio/issues/1151)).
  Compressed formats (AAC/MP3) add encoder padding gaps; WAV minimizes but doesn't
  guarantee seamlessness. Practitioner workarounds: render a long segment (5-15 min)
  so seams are rare, bake a crossfade into the seam during the offline render, or
  double-buffer two `<audio>` elements.
- **Memory kills 90-minute single renders (arithmetic, not anecdote):**
  OfflineAudioContext renders to Float32 — 90 min stereo 44.1 kHz ≈ 1.9 GB
  AudioBuffer, ~950 MB as 16-bit WAV. iOS Safari tab memory ceiling (~1-1.5 GB)
  makes this a crash. Also: iPadOS 15.4-era reports of blob audio >70 KB
  misbehaving ([Apple forum 702835](https://developer.apple.com/forums/thread/702835))
  show blob playback has had its own instability. Solution: binaural programs are
  periodic — render a short loop, or pre-encode staged segments.

## 2. MediaStreamAudioDestinationNode → `srcObject` — DEAD END (VERIFIED)

Two independent kills:
(a) WebAudio spec issues [#1722](https://github.com/WebAudio/web-audio-api/issues/1722)
and [#2293](https://github.com/WebAudio/web-audio-api/issues/2293) document iOS
Safari producing no sound / no `currentTime` advance from
`srcObject = mediaStreamDestination.stream` — the spec doesn't even require it to
play; (b) even where it plays, the source is the `AudioContext`, which suspends on
lock, so the stream goes silent regardless. Apple's stance
([forum 774239](https://developer.apple.com/forums/thread/774239)): live/WebRTC-style
audio has no background entitlement in Safari.

## 3. MSE / ManagedMediaSource — UNPROVEN FOR THIS

ManagedMediaSource shipped iOS 17.1 (VERIFIED: webkit.org blog, Bitmovin, Radiant
Media Player writeups). But it expects encoded segments (fMP4/AAC — would need an
in-browser encoder for synthesized PCM) and is designed for network-buffered
streaming with aggressive power management. Zero evidence found of anyone feeding
it live-generated audio surviving screen lock. Theoretically interesting, no
practitioner proof.

## 4. Silent-audio keepalive hacks — WRONG PROBLEM (VERIFIED)

`unmute.js` / `unmute-ios-audio` / Jeremy Keith's silent-MP3 kick solve the
**mute-switch/ringer-channel** issue, not background suspension.
[Jeremy Keith's update](https://adactio.medium.com/web-audio-api-update-on-ios-1e553fff7847)
notes the kick is no longer needed, and that Web Audio now respects the mute switch
while `<audio>` elements don't. None of these keep an `AudioContext` alive under lock.

## PWA / Add-to-Home-Screen — AVOID (VERIFIED + anecdotal)

[HN thread 24550351](https://news.ycombinator.com/item?id=24550351): "Background
audio is entirely disabled in iOS Safari PWAs. The same sites can handle background
media... as a regular website in Safari." A 2024+ Apple forum thread
([762582](https://developer.apple.com/forums/thread/762582)) reports standalone-mode
audio dying if paused >30 s from the lock screen. Standalone mode is strictly worse
than a Safari tab for audio.

## What practitioners converge on

Every serious generative-audio product (myNoise, Brain.fm, Endel, Generative.fm)
shipped a **native iOS app** for background playback; their web versions accept the
limitation. For web-only, the converged pattern is: **synthesize in the Web Audio
graph, pre-render a loopable segment via OfflineAudioContext (or serve pre-encoded
files), play it through an `<audio>` element with Media Session metadata, in a
Safari tab, with a seam-crossfaded loop.**

## Gaps / NOT found

- No proof anyone has fed ManagedMediaSource live-generated audio in background.
- No workaround for the standalone-PWA limitations; native app is the only full fix.

Sources: Tone.js #235, WebAudio #1722/#2293, HN 24550351, Apple forums
762582/774239/702835, just_audio #1151, Radiant Media Player + Bitmovin MMS
writeups, Jeremy Keith (adactio), unmute-ios-audio, dbushell.com, whatpwacando.today.
