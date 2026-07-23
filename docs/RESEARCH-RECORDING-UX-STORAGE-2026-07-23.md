# Research: Recording UX Patterns + iOS Persistent Storage (2026-07-23)

> For SPEC-AFFIRM-STUDIO. Part A: how the best apps do record/manage/mix flows.
> Part B: whether recordings can survive on iOS Safari, and how.

## Part A — Recording/management UX

**1. Record flow.** Two paradigms: messaging (WhatsApp) = hold-to-record,
slide-to-cancel/lock, stop → preview before sending (VERIFIED). Deliberate
recording (Voice Memos, ThinkUp, Innertune) = **tap-to-record toggle** with
live waveform + elapsed timer, review after stop. For affirmations the tap
paradigm wins: users read a script on screen while recording — ThinkUp's
guidance is "read it a few times before recording," implying the text stays
visible during capture (VERIFIED, thinkup.me FAQ). No countdown documented
anywhere. ThinkUp free tier caps at 4 recordings. "I Am" doesn't record voice
at all (not a pattern source).

**2. Managing recordings.** ThinkUp: list items in playlists, re-record
replaces (no take versioning). Complaints: can't reorder, can't chain
playlists for long sleep sessions. Voice Memos gold standard: list shows
name/date/duration, inline rename, **soft delete** (Recently Deleted folder)
instead of a confirm dialog.

**3. Voice + music layering.** ThinkUp: **two independent volume sliders
(voice vs music), adjustable at playback time**; loop or auto-stop timer
(VERIFIED, FAQ). Complaints: mixer breaks with external (Spotify) music;
background-music bugs. Innertune: own voice or 10 professional voices, 110
soundscapes, affirmations repeated with ~30 s gaps for passive listening;
4.9★/11k. Complaints (anecdotal, review summaries): per-track volume sliders
"make very little difference," abrupt playback stops, background-play bugs.

**4. Preview patterns.** WhatsApp: stop → preview → send/discard. ThinkUp:
voice-only exists as a playlist mode. Synthesis for SyncState: after stop, a
review card with play (voice alone), "hear it mixed" (voice under the current
mix), re-record, save.

## Part B — iOS Safari persistence

**5. IndexedDB blobs.** Reliable on modern iOS (16/17+); base64 workarounds
are iOS ≤12 lore. Quotas (VERIFIED, WebKit "Updates to Storage Policy",
Safari 17+): per-origin up to **60% of disk** in Safari, 15% in in-app
webviews.

**6. 7-day eviction (VERIFIED, webkit.org blog 10218; still current on MDN).**
ITP deletes ALL script-writable storage (IndexedDB, localStorage, SW, Cache)
after **7 days of Safari use** without interacting with the site.
**Home-screen web apps are effectively exempt** — separate days-of-use
counter, reset on each use; WebKit: "We do not expect the first-party in such
a web application to have its website data deleted." Conclusion: Safari-tab
recordings are at real risk for infrequent users; prompt Add-to-Home-Screen
for anyone who records.

**7. navigator.storage.persist().** Supported Safari/iOS 17+ (VERIFIED). No
user prompt; granted "based on heuristics like whether the website is opened
as a Home Screen Web App." Skips quota/LRU eviction, but Apple has never
confirmed it exempts a Safari-tab site from the ITP 7-day deletion — treat as
unprotected there. Clearing Safari website data wipes everything including
PWA storage (anecdotal, widely reported).

**8. Practical gotchas.** iOS MediaRecorder (14.3+) outputs audio/mp4 (AAC) —
store the Blob in IDB **with its mimeType**, chosen via
`MediaRecorder.isTypeSupported()` (Chrome gives webm/opus, which Safari can't
decode — matters if data ever syncs). Replay via `blob.arrayBuffer() →
decodeAudioData` into an AudioBuffer for mixing — this also sidesteps a known
iOS blob-URL <audio> range-request (416) bug. decodeAudioData needs the whole
file; promise form fine on iOS 15+. AudioContext creation/resume inside a
user gesture; getUserMedia requires HTTPS.

## Sources

WebKit blog 10218 (7-day policy) + 14403 (storage policy) + 11353
(MediaRecorder); MDN storage eviction criteria; thinkup.me FAQ +
daily-affirmations guide + justuseapp reviews; innertune.com + Selfpause
review; Apple forums 702835; buildwithmatija iOS recording guide; MagicBell
PWA-iOS guide; getstream WhatsApp voice UX.
