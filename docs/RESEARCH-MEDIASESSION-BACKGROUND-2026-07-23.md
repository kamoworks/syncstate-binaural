# Research: Media Session Position, Background Blip, Ping-Pong Pitfalls (2026-07-23)

> For SPEC-V3. Three platform questions behind device-test round 2. VERIFIED =
> primary source; otherwise flagged.

## 1. setPositionState on iOS Safari

- **VERIFIED (caniuse/MDN BCD):** supported in Safari/iOS Safari since **15.0**
  through current 26.x.
- **VERIFIED (MDN/W3C spec):** `duration` **cannot be omitted** — missing/null/
  negative throws `TypeError`. `Infinity` is explicitly legal ("media without a
  defined end, such as a live stream"). `position` must be ≤ duration;
  `playbackRate` must be nonzero.
- **Lock screen respect: partially anecdotal.** Practitioner writeups confirm
  the iOS lock-screen scrubber is driven by position state and **stays frozen
  if you never call it** — but per spec the UA extrapolates position from
  `position + playbackRate + wall-clock`, so **no polling needed**; call it on
  play/pause/seek/rate change and **again after every `src` swap** (new element
  state resets it). Exact iOS rendering of `duration: Infinity` is unverified —
  test on device. web.dev's sample guards with `isFinite(duration)` (Chromium
  historically threw on Infinity); keep the guard.

## 2. The ~10 s dropout after backgrounding

- **No exact match found** in WebKit Bugzilla / Apple forums / SO for a single
  0.5–1 s dropout at ~10 s. Mechanism is **inferred, anecdotal**.
- **VERIFIED adjacent behavior:** iOS suspends/deprioritizes the WebContent
  process shortly after backgrounding unless a media-playback assertion holds
  ("[ProcessSuspension] Background task expired while holding WebKit
  ProcessAssertion"); WebKit bugs 237878/261554 confirm AudioContext suspension
  on backgrounding even with `audioSession.type='playback'` (iOS 15–17 era);
  WKWebView reports show Web Audio freezing ~27–30 s after backgrounding. An
  `<audio>` element with an active session survives; the glitch almost
  certainly coincides with the process-suspension handshake (JS throttled,
  non-media work parked) while the media pipeline takes the background
  assertion.
- **Mitigations (community practice):** register mediaSession metadata +
  play/pause handlers **before first play** (marks the session system-level
  "playback"); ensure the blob is fully buffered (`preload=auto`, wait for
  HAVE_ENOUGH_DATA) so playback needs zero JS; do nothing in
  `visibilitychange`/`pagehide` handlers; `audioSession.type='playback'`;
  keep Web Audio out of the playback path entirely.

## 3. Two-element ping-pong + Now Playing

- **No specific WebKit bug found** for Now Playing switching targets between
  elements — research gap. But WebKit elects its Now Playing target via an
  internal "main content" heuristic per media element, so each ping-pong **can**
  re-elect the target; widely cited guidance (W3C list, Bitmovin, Apple forums)
  is "one media element, swap src" for consecutive playback. The 2014 W3C
  archive thread "Gapless playback with HTML+JavaScript is impossible"
  documents why double-buffering still gaps: `ended` fires late and `play()`
  has startup latency — worse on iOS.
- **VERIFIED related pitfall:** iOS auto-pauses an HTMLAudioElement when
  another media element (re)starts in some sequences (Apple forums 773152,
  iOS 17/18 era) — the interference class ping-ponging invites. NOTE: v2's
  ping-pong is nonetheless empirically clean on the target device (iPhone 13,
  iOS 26.3.1) — keep it, but re-anchor Media Session (metadata + position
  state) after every handoff, and re-verify on device.
- **Timer throttling:** Safari throttles background setTimeout to ≥1 s
  generally; iOS granularity with playing audio is undocumented — community
  reports say ~1 s timers plus media-clock `timeupdate` (~250 ms–1 s) keep
  firing. **Drive swaps from `timeupdate`/`ended`, never from setTimeout
  arithmetic alone.**

## Sources

MDN setPositionState; caniuse; W3C Media Session; WebKit 237878, 261554; Apple
forums 762582, 773152; W3C www-archive Oct 2014 gapless thread; Mozilla bug
1181073; web.dev media-session; apurvkhare.com media-session article.
