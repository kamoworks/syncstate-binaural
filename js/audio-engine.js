/* ============================================================
 * SyncState Audio Engine
 * Modern Web Audio implementations of:
 *  - US 5,356,368 (Monroe): binaural FFR beats, Septon mode,
 *    phased pink-noise bed, Sleep Processor progressions
 *  - US 5,954,630 (Masaki): Fm theta AM channel + 1/f fluctuation
 *  - US 5,245,666 (Mikell): dynamically masked affirmation channel
 * ============================================================ */

class BinauralEngine {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.paused = false;

    // audible state
    this.state = {
      carrier: 200,      // Hz, base tone
      beat: 10,          // Hz, binaural difference
      volume: 0.6,       // master 0..1
      toneLevel: 0.8,    // tone mix 0..1
      noiseLevel: 0.15,  // pink noise 0..1
      septon: false,     // multi-beat mode
      monaural: 0.35,    // AM depth when septon on
      balance: 0,        // -1..1 ear balance

      // Masaki US 5,954,630 — Fm theta AM channel
      fmOn: false,
      fmCarrier: 150,    // Hz (patent optimum 120–200)
      fmRate: 6.5,       // Hz AM rate (2–10, Fm theta ~6–7)
      fmDepth: 0.8,      // modulation depth (patent optimum 60–90%)
      fmLevel: 0.35,     // channel level 0..1
      fmOneDivF: false,  // 1/f fluctuation augmentation

      // Mikell US 5,245,666 — masked affirmation channel
      affOn: false,
      affRatio: 0.12     // liminal message-to-cover ratio
    };

    this._affBuffer = null;
    this._affSrc = null;
    this._coverEnv = 0;
    this._affGainNow = 0;
    this._fmFluctTimer = null;

    this._stageTimers = [];
    this.onTick = null;      // (remainingSeconds) => {}
    this.onStage = null;     // (stageInfo) => {}
    this.onEnded = null;
    this._sessionEnd = 0;
    this._tickInterval = null;
  }

  /* ---------- lifecycle ---------- */

  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;

    // master chain
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // stereo bus: left channel -> 0, right channel -> 1
    this.merger = ctx.createChannelMerger(2);
    this.earGainL = ctx.createGain();
    this.earGainR = ctx.createGain();
    this.earGainL.connect(this.merger, 0, 0);
    this.earGainR.connect(this.merger, 0, 1);
    this.merger.connect(this.master);

    // tone mix gain
    this.toneBusL = ctx.createGain();
    this.toneBusR = ctx.createGain();
    this.toneBusL.connect(this.earGainL);
    this.toneBusR.connect(this.earGainR);

    // primary binaural pair
    this.oscL = ctx.createOscillator();
    this.oscR = ctx.createOscillator();
    this.oscL.type = 'sine';
    this.oscR.type = 'sine';
    this.oscL.connect(this.toneBusL);
    this.oscR.connect(this.toneBusR);

    // secondary pair (septon: harmonic binaural beat)
    this.oscL2 = ctx.createOscillator();
    this.oscR2 = ctx.createOscillator();
    this.oscL2.type = 'sine';
    this.oscR2.type = 'sine';
    this.septonGainL = ctx.createGain();
    this.septonGainR = ctx.createGain();
    this.septonGainL.gain.value = 0;
    this.septonGainR.gain.value = 0;
    this.oscL2.connect(this.septonGainL);
    this.oscR2.connect(this.septonGainR);
    this.septonGainL.connect(this.toneBusL);
    this.septonGainR.connect(this.toneBusR);

    // monaural component: amplitude modulation at beat freq
    // (per patent: monaural beats within each ear)
    this.amOsc = ctx.createOscillator();
    this.amOsc.type = 'sine';
    this.amDepthL = ctx.createGain();
    this.amDepthR = ctx.createGain();
    this.amDepthL.gain.value = 0;
    this.amDepthR.gain.value = 0;
    this.amOsc.connect(this.amDepthL);
    this.amOsc.connect(this.amDepthR);
    this.amDepthL.connect(this.toneBusL.gain);
    this.amDepthR.connect(this.toneBusR.gain);

    // pink noise bed (slightly decorrelated between ears = "phased" pink sound)
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = this.state.noiseLevel;
    const noise = this._makePinkNoiseStereo(4);
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = noise;
    this.noiseSrc.loop = true;
    this.noiseSrc.connect(this.noiseGain);
    this.noiseGain.connect(this.master);

    /* ---- Masaki US 5,954,630: Fm theta AM channel ----
     * Low audio carrier (150 Hz opt.) amplitude-modulated by a very
     * low frequency wave (2–10 Hz) at 30–100% depth (~80% optimum). */
    this.fmOsc = ctx.createOscillator();
    this.fmOsc.type = 'sine';
    this.fmOsc.frequency.value = this.state.fmCarrier;
    this.fmCarrierGain = ctx.createGain();
    this.fmCarrierGain.gain.value = 0;
    this.fmLFO = ctx.createOscillator();
    this.fmLFO.type = 'sine';
    this.fmLFO.frequency.value = this.state.fmRate;
    this.fmAMDepth = ctx.createGain();
    this.fmAMDepth.gain.value = 0;
    this.fmLFO.connect(this.fmAMDepth);
    this.fmAMDepth.connect(this.fmCarrierGain.gain);
    this.fmOsc.connect(this.fmCarrierGain);
    this.fmCarrierGain.connect(this.master);

    /* ---- Mikell US 5,245,666: masked affirmation channel ----
     * Message -> speech bandpass (400–4000 Hz) -> dynamic gain -> master.
     * Cover envelope probed from tones+noise (internal cover embodiment). */
    this.affBP = ctx.createBiquadFilter();
    this.affBP.type = 'bandpass';
    this.affBP.frequency.value = 1100;   // ~centre of 400–4000 band
    this.affBP.Q.value = 0.5;
    this.affGain = ctx.createGain();
    this.affGain.gain.value = 0;
    this.affBP.connect(this.affGain);
    this.affGain.connect(this.master);

    // cover probe: tones + noise (the masking cover), pre-master
    this.coverProbe = ctx.createGain();
    this.merger.connect(this.coverProbe);
    this.noiseGain.connect(this.coverProbe);
    this.coverAnalyser = ctx.createAnalyser();
    this.coverAnalyser.fftSize = 512;
    this.coverProbe.connect(this.coverAnalyser);
    this._coverBuf = new Float32Array(this.coverAnalyser.fftSize);

    this._applyAll(0);
  }

  _makePinkNoiseStereo(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      // Paul Kellet pink noise filter; different seed per channel = decorrelated
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.11;
      }
    }
    return buf;
  }

  /* ---------- parameter application ---------- */

  _applyAll(rampTime = 0.08) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.state;
    const half = s.beat / 2;
    const set = (param, v) => {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(v, t, rampTime);
    };

    set(this.oscL.frequency, s.carrier - half);
    set(this.oscR.frequency, s.carrier + half);
    set(this.oscL2.frequency, s.carrier - s.beat);       // harmonic pair: 2x beat
    set(this.oscR2.frequency, s.carrier + s.beat);
    set(this.amOsc.frequency, s.beat);

    const sept = s.septon ? 0.25 : 0;
    set(this.septonGainL.gain, sept);
    set(this.septonGainR.gain, sept);
    set(this.amDepthL.gain, s.septon ? s.monaural * 0.5 : 0);
    set(this.amDepthR.gain, s.septon ? s.monaural * 0.5 : 0);

    set(this.toneBusL.gain, s.toneLevel);
    set(this.toneBusR.gain, s.toneLevel);
    set(this.noiseGain.gain, s.noiseLevel);

    // ear balance
    const balL = Math.min(1, 1 - s.balance);
    const balR = Math.min(1, 1 + s.balance);
    set(this.earGainL.gain, balL);
    set(this.earGainR.gain, balR);

    // Masaki FM channel
    set(this.fmOsc.frequency, s.fmCarrier);
    set(this.fmLFO.frequency, s.fmRate);
    if (s.fmOn) {
      set(this.fmCarrierGain.gain, s.fmLevel * (1 - s.fmDepth * 0.5));
      set(this.fmAMDepth.gain, s.fmLevel * s.fmDepth * 0.5);
    } else {
      set(this.fmCarrierGain.gain, 0);
      set(this.fmAMDepth.gain, 0);
    }

    if (this.running && !this.paused) {
      set(this.master.gain, s.volume * 0.5);
    }
  }

  setParam(key, value) {
    this.state[key] = value;
    this._applyAll();
  }

  /* ---------- transport ---------- */

  async start() {
    this._ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.running) {
      this.oscL.start(); this.oscR.start();
      this.oscL2.start(); this.oscR2.start();
      this.amOsc.start();
      this.noiseSrc.start();
      this.fmOsc.start();
      this.fmLFO.start();
      this._startEnvelopeFollower();
      this.running = true;
      this.paused = false;
    }
    if (this.paused) {
      this.paused = false;
    }
    // fade in
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.state.volume * 0.5, t + 2.5);
    this._applyAll();
  }

  stop(fadeSeconds = 3) {
    if (!this.ctx || !this.running) return;
    this._clearProgram();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.0001, t + fadeSeconds);
    this.paused = true;
  }

  /* ---------- session timer ---------- */

  startSessionTimer(minutes) {
    this._sessionEnd = Date.now() + minutes * 60000;
    clearInterval(this._tickInterval);
    this._tickInterval = setInterval(() => {
      const remain = Math.max(0, Math.round((this._sessionEnd - Date.now()) / 1000));
      this.onTick && this.onTick(remain);
      if (remain <= 0) {
        clearInterval(this._tickInterval);
        this.stop(8);
        this.onEnded && this.onEnded();
      }
    }, 1000);
    this.onTick && this.onTick(minutes * 60);
  }

  /* ---------- programmed progressions (Sleep Processor) ----------
   * stages: [{ beat, carrier?, minutes, glide }]
   * Implements the patent's staged descent: Beta -> Alpha -> Theta -> Delta,
   * cyclical REM return, and a wake-up ramp. */

  runProgram(stages, { fadeOutTail = 10 } = {}) {
    this._clearProgram();
    const totalSec = stages.reduce((a, s) => a + s.minutes * 60, 0);
    this.startSessionTimer(totalSec / 60);

    let elapsed = 0;
    stages.forEach((stage, i) => {
      const id = setTimeout(() => {
        const dur = Math.max(2, Math.min(stage.minutes * 60, 45));
        this.glideBeat(stage.beat, dur, stage.carrier);
        this.onStage && this.onStage({ index: i, ...stage });
      }, elapsed * 1000);
      this._stageTimers.push(id);
      elapsed += stage.minutes * 60;
    });
  }

  glideBeat(targetBeat, seconds, targetCarrier) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const half = targetBeat / 2;
    const carrier = targetCarrier || this.state.carrier;
    const ramp = (p, v) => {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(v, t + seconds);
    };
    ramp(this.oscL.frequency, carrier - half);
    ramp(this.oscR.frequency, carrier + half);
    ramp(this.oscL2.frequency, carrier - targetBeat);
    ramp(this.oscR2.frequency, carrier + targetBeat);
    ramp(this.amOsc.frequency, targetBeat);
    this.state.beat = targetBeat;
    this.state.carrier = carrier;
  }

  _clearProgram() {
    this._stageTimers.forEach(clearTimeout);
    this._stageTimers = [];
    clearInterval(this._tickInterval);
  }

  /* ---------- Mikell US 5,245,666: dynamic masking engine ----------
   * Envelope follower on the cover mix with patent timing:
   * ~20 ms attack; release adapts — slow (post-masking) when the cover
   * is high and stable, faster on sudden drops. Message gain tracks the
   * user-calibrated liminal ratio across a wide dynamic range. */

  _startEnvelopeFollower() {
    if (this._envTimer) return;
    let lastEnv = 0, stableTime = 0;
    this._envTimer = setInterval(() => {
      if (!this.ctx || !this.coverAnalyser) return;
      this.coverAnalyser.getFloatTimeDomainData(this._coverBuf);
      let sum = 0;
      for (let i = 0; i < this._coverBuf.length; i++) sum += this._coverBuf[i] ** 2;
      const rms = Math.sqrt(sum / this._coverBuf.length);
      const level = Math.min(1, rms * 5);

      // attack ~20 ms, release 60–150 ms (post-masking adaptive)
      const dt = 0.03; // 30 ms tick
      const stable = level > 0.25 && Math.abs(level - lastEnv) < 0.05;
      stableTime = stable ? stableTime + dt : 0;
      const releaseMs = stableTime > 1.5 ? 150 : 60; // sustained cover → slow release
      const coeff = level > this._coverEnv
        ? 1 - Math.exp(-dt / 0.02)
        : 1 - Math.exp(-dt / (releaseMs / 1000));
      this._coverEnv = this._coverEnv + coeff * (level - this._coverEnv);
      lastEnv = level;

      // message gain = liminal ratio tracked to cover envelope
      const s = this.state;
      let target = 0;
      if (s.affOn && this._affBuffer && this.running && !this.paused) {
        const floor = 0.015; // never fully silent while enabled
        target = Math.min(0.5, Math.max(floor, s.affRatio * (0.2 + this._coverEnv * 1.6)));
      }
      this._affGainNow = target;
      this.affGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
    }, 30);
  }

  async loadAffirmation(source) {
    /* source: URL string or ArrayBuffer */
    this._ensureContext();
    try {
      const ab = typeof source === 'string'
        ? await (await fetch(source)).arrayBuffer()
        : source;
      const buf = await this.ctx.decodeAudioData(ab.slice(0));
      this._affBuffer = buf;
      this._restartAffirmationSource();
      return true;
    } catch (e) {
      console.warn('Affirmation load failed', e);
      return false;
    }
  }

  _restartAffirmationSource() {
    if (!this.ctx || !this._affBuffer) return;
    if (this._affSrc) { try { this._affSrc.stop(); } catch (e) {} }
    this._affSrc = this.ctx.createBufferSource();
    this._affSrc.buffer = this._affBuffer;
    this._affSrc.loop = true;
    this._affSrc.connect(this.affBP);
    this._affSrc.start();
  }

  setAffirmationOn(on) {
    this.state.affOn = on;
    if (on && this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  getMeters() {
    return { cover: this._coverEnv, message: this._affGainNow * 3 };
  }

  /* ---------- Masaki 1/f fluctuation augmentation ----------
   * Slowly wanders the AM rate (±15%) and depth (±10%) on irregular,
   * pink-noise-like intervals — per the patent's finding that 1/f
   * variation of the stimulus augments Fm theta induction. */

  setOneDivF(on) {
    this.state.fmOneDivF = on;
    clearTimeout(this._fmFluctTimer);
    if (!on) return;
    let wander = 0; // pink-ish random walk state
    const step = () => {
      if (!this.state.fmOneDivF || !this.ctx) return;
      wander = wander * 0.7 + (Math.random() * 2 - 1) * 0.3;
      const baseRate = this._fmBaseRate || this.state.fmRate;
      const rate = Math.min(10, Math.max(2, baseRate * (1 + wander * 0.15)));
      const depth = Math.min(1, Math.max(0.3, this.state.fmDepth * (1 + wander * 0.1)));
      const t = this.ctx.currentTime;
      this.fmLFO.frequency.setTargetAtTime(rate, t, 1.2);
      this.fmAMDepth.gain.setTargetAtTime(
        this.state.fmOn ? this.state.fmLevel * depth * 0.5 : 0, t, 1.2);
      // irregular interval: 4–14 s, clustered like 1/f timing
      this._fmFluctTimer = setTimeout(step, 4000 + Math.random() * Math.random() * 10000);
    };
    step();
  }

  setFmRate(rate) {
    this._fmBaseRate = rate;
    this.setParam('fmRate', rate);
  }

  getAnalyser() { return this.analyser; }
}

/* ---------- brainwave band helpers ---------- */

const BANDS = [
  { name: 'Delta', min: 0.5, max: 4,  color: '#7c6cf0', label: 'Deep Sleep · Healing' },
  { name: 'Theta', min: 4,   max: 8,  color: '#4f9cf0', label: 'Meditation · Creativity' },
  { name: 'Alpha', min: 8,   max: 13, color: '#3ecfae', label: 'Relaxation · Calm Focus' },
  { name: 'Beta',  min: 13,  max: 30, color: '#f0b64f', label: 'Alertness · Concentration' },
  { name: 'Gamma', min: 30,  max: 45, color: '#f06c8a', label: 'Peak Awareness · Cognition' }
];

function bandFor(freq) {
  for (const b of BANDS) if (freq >= b.min && freq < b.max) return b;
  return freq < 0.5 ? BANDS[0] : BANDS[BANDS.length - 1];
}

window.BinauralEngine = BinauralEngine;
window.BANDS = BANDS;
window.bandFor = bandFor;
