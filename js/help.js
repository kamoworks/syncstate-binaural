/* ============================================================
 * SyncState Help & Guidance System
 *  - First-run interactive tour with spotlight highlights
 *  - Contextual info popups (bottom sheet) on every feature
 *  - Beginner-friendly copy, re-openable anytime
 * ============================================================ */

const HELP_CONTENT = {
  headphones: {
    title: '🎧 Headphones Are Essential',
    body: 'Binaural beats only work with stereo headphones. Each ear receives a slightly different tone (e.g. 200 Hz left, 204 Hz right) and your brain constructs a third "phantom" beat at the difference (4 Hz). Speakers can\'t do this — the tones mix in the air before reaching your ears.',
    tips: ['Any wired or Bluetooth stereo headphones work', 'Keep volume comfortable — louder is not stronger', 'Effects typically build over 6–10 minutes']
  },
  play: {
    title: '▶ Starting a Session',
    body: 'Tap the big button to start your session. Audio fades in gently over 2.5 seconds. Tap again to stop — it fades out smoothly so there\'s no jarring cutoff.',
    tips: ['Sit or lie somewhere comfortable', 'Close your eyes for deeper states', 'Set a session timer below so it stops automatically']
  },
  timer: {
    title: '⏱ Session Timer',
    body: 'Choose how long your session runs. When time is up, the audio fades out over 8 seconds and stops — perfect for meditation or drifting off without worrying about turning it off.',
    tips: ['20 minutes is a great default', 'Use 10m for a quick reset', 'The Sleep tab has its own multi-hour program']
  },
  beat: {
    title: '〰 Beat Frequency',
    body: 'This is the star of the show — the frequency your brain is encouraged to follow (the Frequency Following Response). Slide slowly: the scale is logarithmic so the low end (sleep frequencies) gets fine control. The colored band name above the play button updates live.',
    tips: ['0.5–4 Hz Delta — deep sleep', '4–8 Hz Theta — meditation, drifting', '8–13 Hz Alpha — calm relaxation', '13–30 Hz Beta — focus and alertness', '30–45 Hz Gamma — peak cognition']
  },
  carrier: {
    title: '🎵 Carrier Tone',
    body: 'The carrier is the actual audible pitch delivered to your ears; the beat is the difference between the two ears. Different carriers feel different — lower carriers (100–150 Hz) feel warm and sleepy, higher carriers (250–350 Hz) feel brighter and more alert.',
    tips: ['Match carrier to your goal: low for sleep, high for focus', 'If the tone feels harsh, lower the carrier', 'The beat frequency is what matters most — carrier is comfort']
  },
  septon: {
    title: '🔱 Septōn Signal',
    body: 'From the Monroe patent: instead of one beat, Septōn mode layers three simultaneous stimuli — the binaural beat, a harmonic binaural pair at double the rate, and a monaural beat (amplitude pulsing) inside each ear. More pathways for the brain to lock onto.',
    tips: ['Try it if plain beats feel subtle', 'Great for the Concentration preset', 'If it feels busy, turn it off — simple works too']
  },
  volume: {
    title: '🔊 Master Volume',
    body: 'Overall loudness. Binaural beats work at low volumes — the effect is neurological, not acoustic. Set it just clearly audible and comfortable.',
    tips: ['Lower is usually better, especially for sleep', 'Never use high volumes for long sessions']
  },
  tone: {
    title: '🎚 Tone Level',
    body: 'How prominent the pure carrier tones are in the mix relative to the noise bed. Reduce it if the tones feel piercing; raise it if you want a clearer signal.',
    tips: ['For sleep, try 50–60% tone with a soft noise bed', 'For focus, 80–100% keeps the signal crisp']
  },
  noise: {
    title: '🌊 Pink Noise Bed',
    body: 'Soft "phased" pink noise (like gentle rain or wind) sits under the tones, per the patent\'s masking layer. It hides background distractions and makes long sessions much more pleasant.',
    tips: ['Great for noisy environments', 'Raise it for sleep, lower it for precise meditation', 'Decorrelated between ears — adds gentle spaciousness']
  },
  balance: {
    title: '⚖ Ear Balance',
    body: 'Shifts loudness between left and right ears. Useful if your headphones or hearing are slightly uneven — center the perceived tone for the cleanest beat.',
    tips: ['Leave at 0% unless something feels off-center', 'Small adjustments (10–20%) are usually enough']
  },
  presets: {
    title: '🧠 State Presets',
    body: 'One-tap recipes based on the patent\'s "Mood Minder" — each sets the beat frequency, carrier tone, and noise mix for a target state. Tapping a preset starts playback automatically.',
    tips: ['Deep Sleep — only in bed, never while working', 'Focus/Concentration — pair with a task timer', 'You can fine-tune any preset afterwards in the Session tab']
  },
  sleep: {
    title: '🌙 Sleep Processor',
    body: 'The patent\'s flagship program. It guides your brainwaves through natural ~90-minute sleep cycles: Alpha settling → Theta descent → Delta deep sleep → Theta REM, repeating. The optional wake-up sequence gradually ramps back up through Alpha into Beta so you surface refreshed instead of groggy.',
    tips: ['4 cycles ≈ 6 hours, 5 cycles ≈ a full night', 'Use 1 cycle for a power nap', 'Keep your phone charging overnight', 'Volume low, noise bed slightly raised']
  },
  fm: {
    title: '🧠 Masaki Focus Tone',
    body: 'From US Patent 5,954,630 (Hayashibara, 1999): a soft low tone amplitude-modulated at 6–7 Hz stimulates "frontal midline theta" (Fmθ) — the brainwave signature of absorbed attention measured in EEG studies. Unlike binaural beats, it works through speakers too, making it ideal for desk work and study.',
    tips: ['6.5 Hz rate is the patent\'s Fm theta sweet spot', 'Keep modulation depth near 80% (the tested optimum)', 'Great paired with the Focus preset or used alone on speakers', '2–10 Hz also supports relaxed alpha states']
  },
  onef: {
    title: '🌿 1/f Fluctuation',
    body: 'Natural rhythms — heartbeat, breathing, flowing water — vary with "1/f" statistics: never perfectly regular, never random. The patent found that gently wandering the modulation rate and depth on these organic intervals significantly augments theta induction and prevents habituation.',
    tips: ['Recommended for sessions over 15 minutes', 'The variation is subtle by design — you shouldn\'t notice it', 'Turn off if you prefer a perfectly steady tone']
  },
  affirm: {
    title: '💬 Affirmations',
    body: 'From US Patent 5,245,666 (Mikell, 1993): positive statements played at the edge of hearing, masked beneath your soundscape. The engine listens to your mix 33 times per second and continuously adjusts the message so it stays hidden but present — using the psychoacoustic "post-masking" effect. Full text of every affirmation is always shown — nothing hidden from you.',
    tips: ['Record your own voice for the strongest personal effect', 'Keep it positive and present-tense: "I am…"', 'Honest science: expect subtle priming, not magic — pair with conscious effort']
  },
  liminal: {
    title: '⚖ Delivery Level',
    body: 'Calibrate like the patent\'s ratio dial: raise the slider until you can just barely make out the words, then back off slightly. "Liminal edge" = at the threshold of awareness; "Subliminal" = just below it. The engine then maintains that relationship automatically as your mix changes.',
    tips: ['Subliminal works well for sleep programs', 'Liminal edge is best for focused daytime use', 'If you hear clear words, it\'s too high — if in doubt, go lower']
  },
  record: {
    title: '🎙 Recording Affirmations',
    body: 'Tap the red button and speak 2–3 short positive phrases clearly, then tap again to finish. Your recording loops seamlessly and is processed entirely on your device — nothing is uploaded anywhere.',
    tips: ['Hold the phone 15–20 cm away, speak calmly', 'Example: "I am calm, capable and focused."', 'Re-record anytime — only the latest take is kept']
  },
  visual: {
    title: '〰 Visualizer',
    body: 'Watch your entrainment signal live: the blue and pink waves are the tones going to each ear, the glowing envelope is the phantom beat your brain constructs, and the bars below are the real-time audio spectrum. The marker on the Delta→Gamma scale shows exactly where your current beat sits.',
    tips: ['A slow, wide envelope = deep states (Delta/Theta)', 'A fast, tight envelope = alert states (Beta/Gamma)', 'Nice as a soft visual focus point for meditation']
  }
};

/* ---------- bottom sheet info popup ---------- */

function showInfoSheet(key) {
  const c = HELP_CONTENT[key];
  if (!c) return;
  closeInfoSheet();
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <h3>${c.title}</h3>
      <p>${c.body}</p>
      ${c.tips ? `<ul>${c.tips.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
      <button class="sheet-close">Got it</button>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('.sheet-close')) closeInfoSheet();
  });
}

function closeInfoSheet() {
  const o = document.querySelector('.sheet-overlay');
  if (!o) return;
  o.classList.remove('open');
  setTimeout(() => o.remove(), 250);
}

/* ---------- guided tour ---------- */

const TOUR_STEPS = [
  { tab: 'session', sel: null, title: 'Welcome to SyncState 👋',
    text: 'A 60-second tour of your binaural consciousness studio. You can reopen this anytime from the ⓘ button.' },
  { tab: 'session', sel: '#playBtn', title: 'Start Here',
    text: 'One tap starts your session with a gentle fade-in. Tap again to stop.' },
  { tab: 'session', sel: '.band-readout', title: 'Your Brainwave Target',
    text: 'This shows which state you\'re entraining — Delta, Theta, Alpha, Beta or Gamma — updating live as you adjust.' },
  { tab: 'session', sel: '.time-chips', title: 'Set a Timer',
    text: 'Sessions stop automatically with a soft fade-out. 20 minutes is a great default.' },
  { tab: 'session', sel: '#beatSlider', title: 'The Beat Frequency',
    text: 'The core control — the frequency your brain follows. Low numbers for sleep, high for focus.' },
  { tab: 'states', sel: '#presetList', title: 'One-Tap States',
    text: 'Ready-made recipes for sleep, meditation, relaxation, focus and more. Tapping one starts playing instantly.' },
  { tab: 'sleep', sel: '#startSleep', title: 'The Sleep Processor',
    text: 'A full night program: guides you through natural 90-minute sleep cycles, then gently wakes you.' },
  { tab: 'affirm', sel: '#affList', title: 'Affirmations 💬',
    text: 'Positive statements masked beneath your mix at the edge of hearing — from US Patent 5,245,666. Record your own voice for the strongest effect.' },
  { tab: 'session', sel: '#fmToggle', title: 'Focus Tone (New)',
    text: 'The Masaki Fm-theta stimulus from US 5,954,630 — sharpens attention and works even on speakers.' },
  { tab: 'visual', sel: '#vizCanvas', title: 'Watch the Beat',
    text: 'See the two ear tones and the phantom beat your brain creates, live.' },
  { tab: 'session', sel: null, title: 'You\'re Ready 🎧',
    text: 'Put on stereo headphones, pick a state, and close your eyes. Tap any ⓘ icon in the app for help on that feature.' }
];

class Tour {
  constructor(steps) {
    this.steps = steps;
    this.i = 0;
    this._build();
  }

  _build() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'tour-overlay';
    this.overlay.innerHTML = `
      <div class="tour-spot"></div>
      <div class="tour-card">
        <div class="tour-step-count"></div>
        <h3></h3>
        <p></p>
        <div class="tour-actions">
          <button class="tour-skip">Skip tour</button>
          <button class="tour-next">Next</button>
        </div>
      </div>`;
    this.spot = this.overlay.querySelector('.tour-spot');
    this.card = this.overlay.querySelector('.tour-card');
    this.overlay.querySelector('.tour-skip').addEventListener('click', () => this.end());
    this.overlay.querySelector('.tour-next').addEventListener('click', () => this.next());
  }

  start() {
    document.body.appendChild(this.overlay);
    requestAnimationFrame(() => this.overlay.classList.add('open'));
    this._show();
  }

  _show() {
    const s = this.steps[this.i];
    if (s.tab) showTab(s.tab);

    // let tab switch render
    setTimeout(() => {
      this.card.querySelector('h3').textContent = s.title;
      this.card.querySelector('p').textContent = s.text;
      this.card.querySelector('.tour-step-count').textContent = `${this.i + 1} of ${this.steps.length}`;
      this.overlay.querySelector('.tour-next').textContent =
        this.i === this.steps.length - 1 ? 'Start Session' : 'Next';

      const target = s.sel ? document.querySelector(s.sel) : null;
      if (target) {
        const r = target.getBoundingClientRect();
        const pad = 10;
        this.spot.style.display = 'block';
        this.spot.style.top = (r.top - pad) + 'px';
        this.spot.style.left = (r.left - pad) + 'px';
        this.spot.style.width = (r.width + pad * 2) + 'px';
        this.spot.style.height = (r.height + pad * 2) + 'px';

        // position card above or below the spotlight
        const cardH = 210;
        const below = r.bottom + 18;
        const above = r.top - cardH - 18;
        this.card.style.top = (below + cardH < window.innerHeight - 90 ? below : Math.max(16, above)) + 'px';
        this.card.style.bottom = 'auto';
      } else {
        this.spot.style.display = 'none';
        this.card.style.top = '50%';
        this.card.style.transform = 'translate(-50%, -50%)';
        this.card.style.bottom = 'auto';
      }
      if (target) this.card.style.transform = 'translateX(-50%)';
    }, 60);
  }

  next() {
    if (this.i >= this.steps.length - 1) return this.end();
    this.i++;
    this._show();
  }

  end() {
    localStorage.setItem('syncstate-tour-v2', 'done');
    this.overlay.classList.remove('open');
    setTimeout(() => this.overlay.remove(), 250);
  }
}

/* ---------- wiring ---------- */

function initHelp() {
  // delegate clicks on any info button
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-info]');
    if (btn) {
      e.stopPropagation();
      showInfoSheet(btn.dataset.info);
    }
  });

  // header help button replays the tour
  const helpBtn = document.getElementById('helpBtn');
  if (helpBtn) helpBtn.addEventListener('click', () => new Tour(TOUR_STEPS).start());

  // first run: auto-start tour
  if (!localStorage.getItem('syncstate-tour-v2')) {
    setTimeout(() => new Tour(TOUR_STEPS).start(), 600);
  }
}

window.SyncHelp = { initHelp, showInfoSheet, Tour };
