/* ============================================================
 * SyncState Audio Engine — media-element-first architecture
 *
 * Implements the same three patents as before:
 *  - US 5,356,368 (Monroe): binaural FFR beats, Septon mode,
 *    phased pink-noise bed, Sleep Processor progressions
 *  - US 5,954,630 (Masaki): Fm theta AM channel + 1/f fluctuation
 *  - US 5,245,666 (Mikell): masked affirmation channel
 *
 * WHY the rewrite (see docs/SPEC-BACKGROUND-PLAYBACK-2026-07-23.md):
 * iOS suspends live Web Audio the moment the screen locks, so the
 * old always-on oscillator graph went silent in the background.
 * Audio is now rendered offline (RenderCore) into seamless WAV
 * loops and played through a single <audio> element (MediaTransport)
 * — the one playback path iOS keeps alive when locked, with
 * lock-screen controls via the Media Session API.
 *
 * Public API is unchanged; app.js / affirmations.js / visualizer.js
 * work as before. Timing (session end, Sleep Processor stages) is
 * wall-clock based and driven from both a foreground interval and
 * the element's timeupdate events, which keep firing in background.
 * ============================================================ */

class BinauralEngine {
  constructor() {
    this.ctx = null;            // decode-only AudioContext (never audible)
    this.running = false;
    this.paused = false;

    this.state = {
      carrier: 200,      // Hz, base tone
      beat: 10,          // Hz, binaural difference
      volume: 0.6,       // master 0..1 (baked into renders — iOS ignores element.volume)
      toneLevel: 0.8,    // tone mix 0..1
      noiseLevel: 0.15,  // pink noise 0..1
      septon: false,     // multi-beat mode
      monaural: 0.35,    // AM depth when septon on
      balance: 0,        // -1..1 ear balance

      // Masaki US 5,954,630 — Fm theta AM channel
      fmOn: false,
      fmCarrier: 150,
      fmRate: 6.5,
      fmDepth: 0.8,
      fmLevel: 0.35,
      fmOneDivF: false,

      // Mikell US 5,245,666 — masked affirmation channel
      affOn: false,
      affRatio: 0.12
    };

    this._affBuffer = null;
    this._coverEnv = 0;
    this._affGainNow = 0;

    this._transport = null;
    this._loop = null;          // { buffer, blob, dur } current seamless loop
    this._vizPcm = null;        // mono PCM of whatever segment is playing
    this._renderSeq = 0;
    this._rebuildTimer = null;
    this._stopping = false;

    this._program = null;
    this._sessionEnd = 0;
    this._sessionLenSec = 0;
    this._tickInterval = null;
    this._lastTickMs = 0;
    this._fadeArmed = false;

    this.onTick = null;         // (remainingSeconds) => {}
    this.onStage = null;        // (stageInfo) => {}
    this.onEnded = null;
    this.onStatus = null;       // (msg|null) => {} render progress
    this.onPlayState = null;    // (isPlaying) => {} lock-screen / interruption sync

    this._analyserShim = {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: arr => this._fillSpectrum(arr)
    };
  }

  /* ---------- transport (lazy) ---------- */

  _t() {
    if (this._transport) return this._transport;
    const t = new MediaTransport({
      onExternalPause: () => {
        if (this._stopping) return;
        this.paused = true;
        this.onPlayState && this.onPlayState(false);
      },
      onExternalPlay: () => {
        if (this._stopping) return;
        this.paused = false;
        this.onPlayState && this.onPlayState(true);
      }
    });
    t.initMediaSession({
      onPlay: () => this._remotePlay(),
      onPause: () => t.pause(),
      onStop: () => { this.stop(1); }
    });
    t.ontimeupdate = () => {
      const now = Date.now();
      if (now - this._lastTickMs >= 900) this._schedulerTick();
    };
    this._transport = t;
    return t;
  }

  _remotePlay() {
    if (!this.running) return;
    this._t().resume();
    this._schedulerTick(); // resync schedule after a pause
  }

  _status(msg) { this.onStatus && this.onStatus(msg); }

  _nowPlayingTitle() {
    if (this._program && this._program.current >= 0) {
      return this._program.stages[this._program.current].label;
    }
    const band = bandFor(this.state.beat);
    return `${band.name} · ${(+this.state.beat).toFixed(this.state.beat < 10 ? 1 : 0)} Hz`;
  }

  _updateNowPlaying() {
    const band = bandFor(this.state.beat);
    this._t().setNowPlaying(this._nowPlayingTitle(), band.label, band.color);
  }

  /* ---------- rendering ---------- */

  async _rebuild({ intro = false, position = 0 } = {}) {
    const seq = ++this._renderSeq;
    const dur = RenderCore.snapLoopSeconds(20, this.state.beat);
    const res = await RenderCore.renderSegment(this.state, {
      seconds: dur, loop: true, affBuffer: this._affBuffer
    });
    if (seq !== this._renderSeq || !this.running || this.paused) return; // superseded
    this._coverEnv = res.coverEnv;
    this._affGainNow = res.affGain;
    const loop = {
      buffer: res.buffer,
      blob: RenderCore.encodeWav(res.buffer),
      dur: res.buffer.length / res.buffer.sampleRate
    };
    this._loop = loop;
    this._vizPcm = RenderCore.monoMix(res.buffer);
    const t = this._t();
    if (intro) {
      // fade-in is a pure-JS envelope over the loop PCM: the one-shot ends
      // exactly at the loop's crossfaded seam, so the chain is continuous
      const introBlob = RenderCore.envelopeBlob(loop.buffer, 0, loop.dur, 'in', 2.5);
      t.playOnce(introBlob, () => {
        if (this._loop === loop && this.running) t.playLoop(loop.blob);
      });
    } else {
      t.playLoop(loop.blob, position % loop.dur);
    }
    this._updateNowPlaying();
  }

  _scheduleRebuild() {
    // During a program the stage renders own the audio; parameter changes
    // are picked up at the next stage render ({...this.state} at render time).
    if (this._program) return;
    if (!this.running || this.paused || this._stopping) return;
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      const pos = this._loop ? this._t().position() : 0;
      this._rebuild({ position: pos }).catch(e => console.warn('render failed', e));
    }, 350);
  }

  /* ---------- parameters (public API unchanged) ---------- */

  setParam(key, value) {
    this.state[key] = value;
    this._scheduleRebuild();
  }

  setFmRate(rate) { this.setParam('fmRate', rate); }

  setOneDivF(on) { this.setParam('fmOneDivF', on); }

  setAffirmationOn(on) {
    this.state.affOn = on;
    this._scheduleRebuild();
  }

  /* ---------- transport (public API unchanged) ---------- */

  async start() {
    const t = this._t();
    t.unlock();                 // MUST run synchronously inside the user gesture
    if (this.running && this.paused && this._loop && !this._program
        && !this._stopping && t.hasSource()) {
      this.paused = false;      // plain pause → resume in place
      t.resume();
      return;
    }
    this.running = true;
    this.paused = false;
    this._stopping = false;
    this._status('Preparing audio…');
    try {
      await this._rebuild({ intro: true });
    } finally {
      this._status(null);
    }
  }

  stop(fadeSeconds = 3) {
    if (!this.running) return;
    this._clearProgram();
    this._sessionEnd = 0;
    clearInterval(this._tickInterval);
    this._renderSeq++;          // cancel any in-flight render
    clearTimeout(this._rebuildTimer);
    this.paused = true;
    const t = this._t();
    if (this._loop && t.shouldBePlaying) {
      this._stopping = true;
      const pos = t.position() % this._loop.dur;
      const fade = Math.max(1, fadeSeconds);
      const blob = RenderCore.envelopeBlob(this._loop.buffer, pos, fade, 'out', fade);
      t.playOnce(blob, () => { t.stop(); this._stopping = false; });
    } else {
      t.stop();
    }
  }

  recoverPlayback() {
    if (this._transport) this._transport.recover();
    this._schedulerTick();
  }

  /* ---------- wall-clock scheduler ----------
   * Driven by BOTH a 1 s interval (foreground) and the audio element's
   * timeupdate events (which iOS keeps firing during background media
   * playback, unlike plain timers). All decisions use Date.now(), so a
   * throttled wakeup self-corrects. */

  startSessionTimer(minutes) {
    this._sessionEnd = Date.now() + minutes * 60000;
    this._sessionLenSec = minutes * 60;
    if (this._fadeArmed && this._loop && this.running && !this.paused) {
      this._fadeArmed = false;  // timer extended mid-fade: back to the loop
      this._t().playLoop(this._loop.blob);
    }
    this._fadeArmed = false;
    clearInterval(this._tickInterval);
    this._tickInterval = setInterval(() => this._schedulerTick(), 1000);
    this.onTick && this.onTick(this._sessionLenSec);
  }

  _schedulerTick() {
    this._lastTickMs = Date.now();
    if (!this.running || this.paused || this._stopping) return;
    const now = Date.now();

    if (this._sessionEnd) {
      const remain = Math.max(0, Math.round((this._sessionEnd - now) / 1000));
      this.onTick && this.onTick(remain);
      const fadeTail = this._program ? this._program.fadeOutTail : 8;
      if (!this._fadeArmed && remain > 0 && remain <= fadeTail && this._loop) {
        this._fadeArmed = true;
        const t = this._t();
        const pos = t.position() % this._loop.dur;
        const blob = RenderCore.envelopeBlob(this._loop.buffer, pos, fadeTail, 'out', fadeTail);
        t.playOnce(blob, () => this._finish());
      } else if (remain <= 0 && !this._fadeArmed) {
        this._finish();
      }
    }

    if (this._program) this._programTick(now);
  }

  _finish() {
    clearInterval(this._tickInterval);
    this._sessionEnd = 0;
    this._clearProgram();
    this._renderSeq++;          // cancel any in-flight render
    clearTimeout(this._rebuildTimer);
    this.paused = true;
    this._fadeArmed = false;
    this._t().stop();
    this.onEnded && this.onEnded();
  }

  /* ---------- Sleep Processor programs (public API unchanged) ----------
   * Each stage gets: a glide one-shot (freq ramp from the previous stage,
   * ≤45 s, as in the live engine) chained into a seamless stage loop.
   * Assets render lazily one stage ahead. If iOS ever withholds JS at a
   * boundary, the current loop simply continues (never silence) and the
   * schedule resyncs on the next tick or on unlock. */

  runProgram(stages, { fadeOutTail = 10 } = {}) {
    this._clearProgram();
    const t0 = Date.now();
    let acc = 0;
    const sched = stages.map((st, i) => {
      const entry = {
        ...st, index: i,
        startMs: t0 + acc * 1000,
        glideSec: Math.max(2, Math.min(st.minutes * 60, 45))
      };
      acc += st.minutes * 60;
      return entry;
    });
    this._program = { stages: sched, current: -1, fadeOutTail };
    this._renderSeq++;          // cancel any in-flight non-program render
    clearTimeout(this._rebuildTimer);
    this.running = true;
    this.paused = false;
    this._stopping = false;
    this.startSessionTimer(acc / 60);
    this._enterStage(0, { fadeIn: 2.5 }).catch(e => console.warn('program start failed', e));
  }

  async _renderStageAssets(st, prev) {
    if (st._loop) return;
    if (!st._rendering) {
      st._rendering = (async () => {
        const stState = { ...this.state, beat: st.beat, carrier: st.carrier || this.state.carrier };
        const g = await RenderCore.renderSegment(stState, {
          seconds: st.glideSec,
          glideFrom: { beat: prev.beat, carrier: prev.carrier || this.state.carrier },
          affBuffer: this._affBuffer
        });
        const l = await RenderCore.renderSegment(stState, {
          seconds: RenderCore.snapLoopSeconds(20, st.beat),
          loop: true,
          affBuffer: this._affBuffer
        });
        st._glideBuf = g.buffer;
        st._loop = {
          buffer: l.buffer,
          blob: RenderCore.encodeWav(l.buffer),
          dur: l.buffer.length / l.buffer.sampleRate
        };
        this._coverEnv = l.coverEnv;
        this._affGainNow = l.affGain;
      })();
    }
    return st._rendering;
  }

  async _enterStage(i, { fadeIn = 0 } = {}) {
    const p = this._program;
    if (!p || i >= p.stages.length) return;
    const st = p.stages[i];
    const prev = i > 0 ? p.stages[i - 1] : { beat: this.state.beat, carrier: this.state.carrier };
    p.current = i;                       // claim before awaiting (no double entry)
    if (i === 0) this._status('Preparing program…');
    await this._renderStageAssets(st, prev);
    this._status(null);
    if (this._program !== p || p.current !== i || !this.running) return;

    this.state.beat = st.beat;
    if (st.carrier) this.state.carrier = st.carrier;
    this._loop = st._loop;

    if (fadeIn) {
      const chans = [st._glideBuf.getChannelData(0), st._glideBuf.getChannelData(1)];
      RenderCore.applyEdgeFade(chans, st._glideBuf.sampleRate, fadeIn, 'in');
    }
    const glideBlob = RenderCore.encodeWav(st._glideBuf);
    this._vizPcm = RenderCore.monoMix(st._glideBuf);

    const t = this._t();
    t.playOnce(glideBlob, () => {
      if (this._program === p && p.current === i && this.running) {
        t.playLoop(st._loop.blob);
        this._vizPcm = RenderCore.monoMix(st._loop.buffer);
      }
    });
    this.onStage && this.onStage({ index: i, beat: st.beat, carrier: st.carrier, minutes: st.minutes, label: st.label });
    this._updateNowPlaying();

    // prefetch next stage during this one (windows are minutes long)
    const nxt = p.stages[i + 1];
    if (nxt) this._renderStageAssets(nxt, st).catch(() => {});
    // free assets two stages back
    const old = p.stages[i - 2];
    if (old) { old._glideBuf = null; old._loop = null; old._rendering = null; }
  }

  _programTick(now) {
    const p = this._program;
    if (!p || p.current < 0) return;
    // find the stage we SHOULD be in (handles long background throttling)
    let target = p.current;
    for (let j = p.current + 1; j < p.stages.length; j++) {
      if (now >= p.stages[j].startMs) target = j;
    }
    if (target > p.current) {
      this._enterStage(target).catch(e => console.warn('stage transition failed', e));
    }
  }

  _clearProgram() {
    this._program = null;
  }

  /* ---------- Mikell affirmations (public API unchanged) ---------- */

  _ensureDecodeCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();        // decode-only; never connected to output
  }

  async loadAffirmation(source) {
    this._ensureDecodeCtx();
    try {
      const ab = typeof source === 'string'
        ? await (await fetch(source)).arrayBuffer()
        : source;
      const buf = await this.ctx.decodeAudioData(ab.slice(0));
      this._affBuffer = buf;
      if (this.state.affOn) this._scheduleRebuild();
      return true;
    } catch (e) {
      console.warn('Affirmation load failed', e);
      return false;
    }
  }

  getMeters() {
    return { cover: this._coverEnv, message: this._affGainNow * 3 };
  }

  /* ---------- visualizer (public API unchanged) ----------
   * The shim runs a real FFT over the rendered PCM at the element's
   * playhead — the spectrum shown is the actual audio being played. */

  getAnalyser() { return this._analyserShim; }

  _fillSpectrum(arr) {
    if (!this._vizPcm || !this.running || this.paused) { arr.fill(0); return; }
    const pos = Math.floor(this._t().position() * RenderCore.SAMPLE_RATE);
    RenderCore.fftByteSpectrum(this._vizPcm, pos, 2048, arr, true);
  }
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
