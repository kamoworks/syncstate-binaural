# Spec: Affirm Studio — Voice Recording Rebuilt (2026-07-23)

**Status: COMPLETE — awaiting Kamo's greenlight. Slots in as Phase 1.5,
before the V3 Glide Engine phase.**

Context: Phase 1 (zero-cut audio core) confirmed working on-device. Next
evolution: the Record Your Voice tool is broken on iOS, and the whole Affirm
tab needs seamless record / preview / select / stop / delete / re-record.

## Part 1 — Diagnosis (from code)

### A. Why recording fails ("Microphone access is needed to record")

1. **Prime suspect: our own background-audio fix.** `MediaTransport` sets
   `navigator.audioSession.type = 'playback'` at construction (playback.js) —
   the sanctioned lever that keeps audio alive when locked (v2). But a
   playback-only audio session **does not permit microphone capture**; if iOS
   enforces the session type against `getUserMedia`, the call fails before any
   permission prompt — matching the exact symptom: no prompt on first use, and
   manually setting Allow changes nothing. Pending agent verification of the
   exact semantics + the record-capable type ('play-and-record') and dynamic
   switching behavior.
2. **The error is swallowed** (violates the fail-loudly rule): the catch in
   affirmations.js shows one generic message for EVERY failure class
   (NotAllowedError, NotFoundError, InvalidStateError, missing
   `mediaDevices`…). The real error name was never surfaced, which is why this
   took a device round to find. The rebuild maps each error to specific
   guidance and shows the raw name in small print.
3. Note: Safari never prompts for mic at page load by design — prompts can
   only follow a user-gesture `getUserMedia` call. The "no prompt on
   loading/reloading" observation is expected platform behavior; the bug is
   that the first tap never got far enough to trigger the prompt.

### B. What else is missing for a complete Affirm experience

| Gap | Today | Consequence |
|---|---|---|
| Persistence | `_affBuffer` in memory only | Recording lost on every reload |
| Preview | none | Can't hear your take alone before committing it under the mix |
| Manage takes | single hidden buffer | No list, no delete, no re-record flow, no durations |
| Recording feedback | button turns red | No level meter, no elapsed time, no max-length guard |
| Session interplay | unknown on iOS | Recording while the mix plays may pause/duck playback (agent verifying) |

## Part 2 — Research inputs (complete)

- `RESEARCH-IOS-MIC-AUDIOSESSION-2026-07-23.md` — **root cause CONFIRMED from
  the W3C spec**: a mic track is ended unless `audioSession.type` is
  `play-and-record` or `auto`; we pin `playback`. Also: mic activation
  reroutes/ducks playing audio (sometimes persisting after) → pause the
  session during capture and restore the type after; MediaRecorder =
  audio/mp4, assemble in onstop, reject sub-1 s takes; standalone PWAs may
  re-prompt per launch; denied state = instant NotAllowedError, prompt only
  ever appears on the gesture call.
- `RESEARCH-RECORDING-UX-STORAGE-2026-07-23.md` — tap-to-record with the
  script visible (ThinkUp pattern); review-before-save (play solo / mixed /
  re-record / save); Voice Memos list management with soft delete; IndexedDB
  is reliable for audio blobs on modern iOS with generous quotas; **Safari-tab
  storage is subject to 7-day ITP eviction, home-screen apps are exempt**;
  `navigator.storage.persist()` (iOS 17+) helps but doesn't beat ITP in a tab.

## Part 3 — The plan

### 3.1 The mic fix (audio-session choreography)

1. On record tap: if a session is playing → `transport.pause()` (seamless,
   with status "Session paused while you record"); set
   `navigator.audioSession.type = 'play-and-record'`; THEN `getUserMedia`.
2. Constraints: `{audio: {echoCancellation: false, noiseSuppression: false,
   autoGainControl: false}}`, falling back to plain `{audio: true}` on
   failure.
3. On every exit path (save, discard, error): stop tracks → restore
   `audioSession.type = 'playback'` → resume the session if it was playing.
4. **Fail loudly, specifically**: per-error guidance replaces the single
   generic message — NotAllowedError → step-by-step Safari settings path
   (aA menu → Website Settings → Microphone → Allow); NotFoundError → no mic
   found; promise-pending → "Waiting for permission…" state; anything else →
   human message + the raw error name in small print.
5. MediaRecorder: mimeType via `isTypeSupported(['audio/mp4', ...])`;
   assemble the blob in `onstop`; reject takes under 1 s ("too short — speak
   for a few seconds"); auto-stop at 90 s with a visible countdown from 80 s.

### 3.2 Affirm Studio UX

**Record card, three states:**
- *Idle*: record button + an editable **script area** (prefilled with a
  library text or the user's own words; persisted in localStorage) that stays
  visible while recording — the ThinkUp read-while-recording pattern.
- *Recording*: pulsing indicator, elapsed time, **live level meter** (analyser
  on the mic stream), tap again to stop.
- *Review*: play the take **solo**; Save; Re-record; Discard. Saving adds it
  to My Recordings and selects it under the mix (that IS the "hear it mixed"
  step, one tap, via the existing seamless rebuild).

**My Recordings (new, IndexedDB-persisted):**
- Schema: `{id, name, blob, mimeType, duration, createdAt}`; auto-named
  ("Take · 23 Jul 10:42") with inline rename.
- Cards behave exactly like library cards (Phase 1 semantics): tap = select
  (decode → masked under the mix), tap active = stop/deselect (✕), plus a
  small solo-preview button and delete with a 10 s undo snackbar (soft
  delete, no confirm dialog).
- Practical cap ~20 takes; oldest-take warning past it.

**Persistence guardrails:** on first save call `navigator.storage.persist()`;
if running in a Safari tab (not standalone), one-time note: "Safari can clear
recordings if you don't visit for 7 days — add SyncState to your Home Screen
to keep them safe." Standalone note when re-prompted for mic: that's iOS
behavior, not a bug.

### 3.3 Where these patterns generalize (next runs)

1. **IndexedDB layer** → My States (Phase 2) stores custom presets; later, a
   render cache (persist favorite loops → instant session start, less
   battery); session history if ever wanted.
2. **Solo-preview element** → audition presets from the States tab and
   Phase 3 soundscape beds before committing.
3. **Mic + level-meter machinery** → myNoise-style ambient calibration
   (measure room noise floor → suggest bed level); future breath-pacing.
4. **Audio-session choreography** → the reusable pattern for ANY future
   capture feature without breaking background playback.
5. **Script area** → foundation for an affirmation composer (user-extended
   text library) if the Affirm tab keeps growing.

### 3.4 Verification

- Local: syntax + harness (error-mapping table and IDB wrapper API as pure
  units where possible).
- Device checklist (new "Affirm Studio round"): first-tap permission prompt
  appears; record while session playing (pauses → resumes, output NOT
  degraded afterward — the big regression risk); level meter moves; review
  solo play; save → survives reload (Safari tab AND home-screen app); rename;
  delete + undo; re-record; select/deselect a saved take seamlessly.
