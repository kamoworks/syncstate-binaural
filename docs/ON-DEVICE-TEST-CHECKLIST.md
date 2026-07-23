# On-Device Test Checklist — Background Playback

The rebuild is verified locally (syntax + 37-assertion unit harness), but the
whole point of this feature lives on the iPhone. Run these on the live site:
https://kamoworks.github.io/syncstate-binaural/

Run the Safari-tab column first — it's the reliable surface. Then repeat in the
Home Screen app (Apple has an open iOS 26.0.x regression there; if it fails, the
Safari tab is the recommended surface until Apple fixes it).

| # | Test | Expected |
|---|------|----------|
| 1 | Tap a preset, wait ~5 s, **lock the phone** | Audio keeps playing through the lock |
| 2 | While locked, check the lock screen | SyncState card with band-tinted artwork; play/pause works |
| 3 | Unlock, **switch to another app** for 2+ min | Audio continues; returning to the app shows correct timer |
| 4 | Flip the **ring/silent switch** to silent | Audio keeps playing (media elements are exempt) |
| 5 | Let a 10-min session **end while locked** | 8 s fade-out, then silence; UI shows Ready on return |
| 6 | Move a slider mid-session | Change applies after ~1 s with at most a small blip |
| 7 | Start a **1-cycle Sleep Program**, lock, spot-check at ~5 and ~15 min | Stage has advanced (Settling → Descent → Deep Sleep); listen for the beat slowing |
| 8 | Loop seam listen: play 2+ min on one preset | No click/gap every ~20 s |
| 9 | Take a phone call (or Siri) mid-session | Audio pauses; play resumes from lock screen or app |
| 10 | Affirmations: load "Calm", enable, listen | Voice faintly present under the mix at the set level |

Known limits (by design / platform):
- Force-quitting Safari or the app stops audio — true for any app.
- Sleep stage transitions in the background depend on iOS letting the page run
  JS at the boundary; if it doesn't, the current stage keeps looping (never
  silence) and the schedule resyncs the moment you wake the phone.
- First play after opening takes ~1 s ("Preparing audio…") — the session is
  being rendered.

Record results per row (Safari tab / Home Screen app, iOS version) and feed
failures back into docs/SPEC-BACKGROUND-PLAYBACK-2026-07-23.md.
