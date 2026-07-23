# Research: iOS Background Audio for Web Apps (2026-07-23)

> Agent 1 of 2 for the SyncState background-playback feature. Question: what is the
> CURRENT (iOS 17/18/26) behavior of background audio for web apps on iOS — Safari
> tabs vs standalone home-screen PWAs? Findings below flag VERIFIED (primary source)
> vs ANECDOTAL (forum/blog reports).

## 1. HTML `<audio>` element on screen lock

**Safari tab: continues playing (VERIFIED).** Media-element playback is the privileged
path on iOS; WebKit engineers treat it as the reference behavior — in
[WebKit bug 261554](https://bugs.webkit.org/show_bug.cgi?id=261554) the assignee
(Youenn Fablet, Apple) states background Web Audio should "match what happens for
regular audio elements," confirming `<audio>` elements keep playing when
backgrounded/locked.

**Standalone (Add-to-Home-Screen) PWA: unreliable.** Two active Apple Developer
Forums threads (primary venue, but user reports, no Apple staff answer):

- [Thread 762582](https://developer.apple.com/forums/thread/762582): in a standalone
  PWA, lock-screen play/pause via MediaSession works until audio sits paused ~30 s;
  then the play button dead-ends until the PWA is re-foregrounded. Android unaffected.
- [Thread 805900](https://developer.apple.com/forums/thread/805900): **iOS 26.0.1
  regression** — media playback broken in standalone PWAs while identical content
  works in a Safari tab (`InvalidStateError: Failed to start the audio device` on
  `AudioContext.resume()`, sequential playback stops when locked; a phone restart
  helps for one session). Open/unresolved as of Nov 2025.

Verdict: `<audio>` in a Safari tab is dependable across iOS 15-26; standalone mode
has recurring per-version breakage (ANECDOTAL but heavily corroborated).

## 2. Web Audio API (AudioContext/Oscillator, no media element)

**Suspended on background/lock — VERIFIED from WebKit Bugzilla**
([124348](https://bugs.webkit.org/show_bug.cgi?id=124348),
[237878](https://bugs.webkit.org/show_bug.cgi?id=237878),
[261554](https://bugs.webkit.org/show_bug.cgi?id=261554)).

Version history from bug 261554: iOS 17.0 suspended AudioContext on background even
with `navigator.audioSession.type = 'playback'`; fixed in 17.1; regressed
17.2-17.3.1; fixed again ~iOS 17.5 (commit landed Mar 2024). Post-17.5, an
AudioContext with `audioSession.type='playback'` is *supposed* to survive
backgrounding like a media element; field reports of re-suspension (e.g. "locks
again after 5 s on iOS 18.5") persist (ANECDOTAL). Screen lock also suspends WebRTC
audio ([Apple forum 774239](https://developer.apple.com/forums/thread/774239)).

**Silent-switch quirk (documented by Jeremy Keith,
[adactio.com](https://adactio.com/journal/19929)):** since ~iOS 17, pure Web Audio
output is muted when the ring/silent switch is on silent; `<audio>`/`<video>`
elements are exempt. `audioSession.type='playback'` is the intended opt-out.

## 3. MediaSession API

**Supported on iOS Safari (VERIFIED via
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)/caniuse;
artwork fixes shipped in Safari 16.4 per
[WebKit blog](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)).**
Works in standalone PWAs too (that's the context of thread 762582).

Practical behavior ([overdevs.com](https://overdevs.com/ios-mediasession.html),
[dbushell.com](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/) —
ANECDOTAL): `play`, `pause`, `seekto` work; registering `seekforward`/`seekbackward`
hides `nexttrack`/`previoustrack` buttons (iOS shows one pair); artwork was
pixelated until iOS 18 (now 512×512); `album` isn't shown when `artist` is set.
Metadata requires an actually-playing media element as the "now playing" source.

## 4. MediaStreamAudioDestinationNode → `<audio>` bridge

**No primary-source guarantee.** This is the long-standing community workaround to
launder Web Audio into media-element privileges. Status is mixed: WebKit's own fix
direction (bug 261554) was to make `audioSession.type='playback'` grant the same
privilege directly, and reporters on that bug said silent/bridged audio-element
tricks were **not reliable** on iOS 17.x. On current iOS it sometimes helps in
Safari tabs but does not rescue the iOS 26.0.1 standalone-PWA breakage (ANECDOTAL,
conflicting reports). Do not architect around it as a guarantee.

## 5. Settings that matter

- **`navigator.audioSession.type = 'playback'`** — the
  [W3C Audio Session API](https://www.w3.org/TR/audio-session/), shipped as a subset
  in Safari 16.4 (VERIFIED, WebKit blog). The sanctioned lever for silent-switch
  playback and background Web Audio.
- **No manifest key** exists for background audio; `playsinline` affects inline
  video only.
- **Wake Lock API**: unsupported on iOS Safari (WebKit bug 254545), so keeping the
  screen awake isn't an escape hatch.

## Bottom line

`<audio>` element + MediaSession in a Safari tab is the only robust path. Standalone
PWA background audio is broken again on iOS 26.0.x. Pure Web Audio needs
`audioSession.type='playback'` and still has a regression-prone history.

## Gaps / NOT found

- No Apple staff answer on the standalone-PWA lock-screen breakage threads.
- No manifest-level or entitlement-style fix exists for PWAs.
