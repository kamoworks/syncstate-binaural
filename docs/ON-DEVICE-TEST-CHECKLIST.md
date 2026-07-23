# On-Device Test Checklist — Background Playback

## Affirm Studio round (Phase 1.5) — run these first

| # | Test | Expected |
|---|------|----------|
| A1 | Tap record with a session playing | Session pauses; Safari shows the mic permission prompt (first time); recording starts with timer + moving level meter |
| A2 | Stop → review → Save | Take appears in My Recordings AND starts playing masked under the mix; session resumed |
| A3 | Record a SECOND time (the old repeat-record bug) | Mic works again — no "Microphone access" error |
| A4 | After recording ends, listen to the session | Output back at FULL quality — not quiet/tinny (the big iOS regression risk) |
| A5 | Review → Play (solo), Re-record, Discard | All three work; Discard resumes the session |
| A6 | My Recordings: tap a take / tap again | Selects under mix (✕ shows) / stops — same as library cards |
| A7 | 🎧 solo preview on a saved take | Session pauses, voice plays alone, session resumes at the end |
| A8 | ✎ rename, 🗑 delete → Undo | Rename sticks; delete shows Undo bar; Undo restores; letting it expire removes it |
| A9 | Reload the page | Saved recordings still listed and playable |
| A10 | Too-short take (tap stop immediately) | Friendly "too short" message, session resumes, no broken state |

### Round 2 fixes (v5) — retest

| # | Test | Expected |
|---|------|----------|
| A11 | Play a saved take (solo AND under the mix) with headphones | Voice in BOTH ears, centered (old takes auto-migrate on load) |
| A12 | Select a take, Delivery Level at "Clearly audible", session playing | Voice plainly audible over the mix (takes are now level-normalized) |
| A13 | Record + save a new take | No "Could not save" error; take listed and survives reload |
| A14 | Listen to a saved take's loop | Starts near-instantly on the voice (leading silence trimmed) |

## Phase 1 review round (V3 Pillar 1) — run these first

| # | Test | Expected |
|---|------|----------|
| P1 | Move any slider / tap another preset while playing | NO audio cut — a brief ~0.3 s blend into the new sound |
| P2 | Start a preset, leave the app immediately, listen 60 s | No cut ~10 s after leaving (the intro no longer ends early) |
| P3 | Lock screen during a 20-min session | Timeline shows session progress (e.g. 3:12 / 20:00) and advances |
| P4 | Pause from the lock screen, reopen the app | App shows paused state correctly; play resumes |
| P5 | Affirm tab: tap "Calm", then tap it again | Second tap stops + deselects (✕ shows while active); toggle stays off |
| P6 | Affirm on/off toggle while playing | Voice appears/disappears with NO audio cut |
| P7 | Quiet-room listen at low volume, Deep Sleep preset | Tone sounds clean (dither) — no faint graininess/buzz under the tone |

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
| 8 | Loop seam listen: play 6+ min on one preset, foreground | Continuous audio; at worst a subtle flutter every ~2.5 min (v2 ping-pong handoff) |
| 8b | Same, but locked for 6+ min | Continuous; worst case one brief gap per ~2.5 min (ended-event backstop) |
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
