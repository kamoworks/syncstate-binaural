# Research: Entrainment/Sleep-Sound App Competitive Scan (2026-07-23)

> For SPEC-V3. Question: what do the best brainwave/sleep apps do for controls,
> session flows, layering, and visuals; what do users complain about; what can a
> web app exploit? Sources at bottom; review-derived points are inherently
> anecdotal but cross-checked across stores/Trustpilot/Reddit.

## 1. Control UX (most common pattern first)

- **Presets-first, controls-second is the dominant winning pattern.** BrainWave
  37 (4.87★, 10.6k reviews, Huberman-endorsed, $3.99 one-time) sells 37 named
  *multi-stage programs* (Deep Sleep, Power Nap, Motivation) plus a separate
  "Pure Tones" mode with 20 fixed frequencies. Brain.fm reduces everything to
  activity (Focus/Relax/Sleep) + genre + a 3-step **"Neural Effect Level"**
  (Low/Medium/High) — one intensity knob, widely praised as the right amount of
  control.
- **Pro-control outliers:** brainaural.com exposes 7 sliders (brainwave,
  carrier, A-mod isochronic, binaural, stereo/bilateral, F-mod, noise) and can
  stack 5 simultaneous frequencies — loved by tinkerers, invisible to normies.
  Gnaural is the extreme: full frequency/amplitude/phase envelope editor, but
  its "outdated, unintuitive UI, no mobile app" is exactly why it stayed niche.
- **Gliding transitions exist but as programs, not UI.** BrainWave's core
  differentiator is multi-stage sequences that ramp frequency gradually over a
  session. Gnaural's whole model is drawn frequency curves over time. No
  mainstream app is praised for *live* smooth parameter morphing when you drag
  a control — brainaural changes are instant/abrupt. **A web app that glides
  carrier/beat changes over 2–5 s would be genuinely novel.**
- **Endel's "Tune Sound" 2D puck** (drag across a pad labeled "Bright"/"Spacy")
  is the category's most-cited innovative control — mood-space instead of
  frequency numbers.

## 2. Session flows

- Table stakes: **sleep timer + fade-out**. BetterSleep's Advanced Timer does
  progressive fade-out AND a **fade-in alarm that wakes you into your favorite
  mix** — the most complete loop (sound → sleep → wake) in the category.
  Atmosphere's timer is a top complaint because it *doesn't fire reliably*.
- Brain.fm: infinite / countdown / **Pomodoro interval timers**; a noted gripe
  is the mobile app lacking the desktop's custom timers. Cross-device session
  continuity is called out positively.
- **Favorites/saved custom mixes** are universal (BetterSleep, Atmosphere,
  myNoise). Streaks/history are rare in this niche (Brain.fm tracks listening
  time; nobody is loved for gamification — low priority).

## 3. Sound layering

- **BetterSleep is the benchmark:** 300+ sounds, mix up to **9 layers with
  independent volume per layer**, including per-layer spatial placement
  ("distant thunder on the far left channel"), with isochronic brainwaves and
  binaural beats as *layers inside the mixer* alongside rain/pink noise.
- **myNoise's calibrated 10-slider generators** are the cult favorite: sliders
  are *frequency bands of one sound*, calibrated to your hearing, plus
  **Animate mode** (sliders drift automatically) to prevent monotony. Directly
  applicable to a pink-noise bed.
- Atmosphere: volume + speed + L/R balance per sound; **user-uploaded audio**.
- Most-demanded ambient beds: rain (and rain-on-surfaces), ocean, thunder,
  wind/forest, white/pink/brown noise, fan.

## 4. Visual design norms

- Premium tier = **dark UI + generative, sound-reactive abstract animation.**
  Endel (Apple Design Award) is the signature: slow particle/blob visuals that
  react to audio, deliberately non-distracting. Brain.fm: subdued animated
  gradients. BetterSleep: dark navy gradients with illustrated scenes. Nothing
  in the binaural-specific subcategory (BrainWave, brainaural) has good visuals
  — a breathing-orb/particle visual on a dark canvas would put SyncState
  visually above every dedicated entrainment app.

## 5. Complaint gaps to exploit

1. **Subscription dark patterns** — #1 complaint for Brain.fm (trial charging,
   billing after cancel) and Endel ($60 charged immediately on a 7-day trial,
   upsell nags every launch). BrainWave's love is partly *because* it's $3.99
   once, no IAP.
2. **Free tier gutted over time** (BetterSleep's top complaint).
3. **Repetitive content** (Brain.fm library, Endel modes, BrainWave "no new
   tracks").
4. **Battery drain + online-only generation** (Endel; offline requires paying).
5. **Broken timers** (Atmosphere).
6. **Onboarding bloat** (Endel updates "made it harder").

## 6. Web-specific

- Web versions are second-class everywhere: Brain.fm web = no offline; Endel =
  connection-dependent generation. **Offline PWA support is the single biggest
  web-app win available** — SyncState generates everything locally and can be
  fully offline, unlike streaming competitors.
- brainaural and myNoise prove free web + one-time donation/purchase converts
  goodwill; keep one entitlement across surfaces.
- Ship: install prompt, Media Session lock-screen controls, background-audio
  reliability — the exact places web sleep apps "feel worse."

## Sources

BrainWave App Store listing; Brain.fm reviews (makeheadway, Trustpilot) +
Neural Effect docs; Endel Pratt design critique + justuseapp reviews;
BetterSleep review (mattressmiracle) + timer FAQ; myNoise FAQ + iOS review;
brainaural.com; Gnaural alternativeto; Atmosphere Google Play.
