/* ============================================================
 * SyncState Render Core
 * Offline (faster-than-realtime) rendering of the three-patent
 * DSP graph into loopable PCM, for background-surviving playback
 * through an HTML <audio> element (see docs/SPEC-BACKGROUND-
 * PLAYBACK-2026-07-23.md — iOS suspends live Web Audio on lock;
 * only media-element playback continues).
 *
 * Pure helpers (encodeWav, fft, snapLoopSeconds, applyEdgeFade)
 * have no DOM/WebAudio dependency and are unit-tested in Node.
 * ============================================================ */

const RenderCore = (() => {

  // 24 kHz: highest content is the ~4 kHz affirmation band edge and the pink
  // noise bed — Nyquist at 12 kHz covers it, and long loops (v2 uses ~150 s to
  // make iOS's non-gapless wrap rare) halve their memory/render cost vs 44.1k.
  const RENDER_RATE = 24000;
  const SEAM_XFADE = 0.25;   // s, tail-into-head crossfade baked into loops

  function newOfflineCtx(channels, length, rate) {
    const OAC = (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext));
    return new OAC(channels, length, rate);
  }

  /* ---------- pure: loop duration snapped to whole beat cycles ----------
   * Keeps the beat envelope continuous across the loop seam; the
   * crossfade below handles carrier phase and noise content. */
  function snapLoopSeconds(target, beat) {
    const b = Math.max(0.25, beat || 1);
    const cycles = Math.max(1, Math.round(target * b));
    return cycles / b;
  }

  /* ---------- pure: 16-bit PCM WAV encoder ----------
   * buffer: AudioBuffer or {numberOfChannels, length, sampleRate, getChannelData} */
  function encodeWav(buffer) {
    const nCh = buffer.numberOfChannels;
    const len = buffer.length;
    const rate = buffer.sampleRate;
    const bytesPerFrame = nCh * 2;
    const dataSize = len * bytesPerFrame;
    const ab = new ArrayBuffer(44 + dataSize);
    const dv = new DataView(ab);
    const wstr = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);              // PCM
    dv.setUint16(22, nCh, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * bytesPerFrame, true);
    dv.setUint16(32, bytesPerFrame, true);
    dv.setUint16(34, 16, true);
    wstr(36, 'data'); dv.setUint32(40, dataSize, true);
    const chans = [];
    for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        // TPDF dither (±1 LSB): decorrelates 16-bit quantization error —
        // audible on exactly this app's content (quiet pure tones)
        let v = Math.round(s * 32767 + (Math.random() + Math.random() - 1));
        if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
        dv.setInt16(off, v, true);
        off += 2;
      }
    }
    return typeof Blob !== 'undefined'
      ? new Blob([ab], { type: 'audio/wav' })
      : ab; // Node test path
  }

  /* ---------- pure: in-place fade applied to channel arrays ----------
   * kind 'in' fades the first `seconds`, 'out' fades the last `seconds`. */
  function applyEdgeFade(channels, sampleRate, seconds, kind) {
    const n = Math.min(channels[0].length, Math.floor(seconds * sampleRate));
    const total = channels[0].length;
    for (let i = 0; i < n; i++) {
      const g = i / n;
      for (const ch of channels) {
        if (kind === 'in') ch[i] *= g;
        else ch[total - 1 - i] *= g;
      }
    }
  }

  /* ---------- pure: radix-2 FFT magnitudes → AnalyserNode-style bytes ----------
   * Used by the visualizer shim: real input (Hann-windowed), returns
   * byte bins mapped like getByteFrequencyData (minDb -100, maxDb -30). */
  function fftByteSpectrum(pcm, offset, fftSize, out, smooth) {
    const N = fftSize;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = pcm[(offset + i) % pcm.length] || 0;
      re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); // Hann
    }
    // bit-reversal
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const ang = (-2 * Math.PI) / size;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += size) {
        let cwr = 1, cwi = 0;
        for (let k = 0; k < size / 2; k++) {
          const a = i + k, b = i + k + size / 2;
          const tr = re[b] * cwr - im[b] * cwi;
          const ti = re[b] * cwi + im[b] * cwr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const nwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr; cwr = nwr;
        }
      }
    }
    const minDb = -100, maxDb = -30;
    const bins = Math.min(out.length, N / 2);
    for (let k = 0; k < bins; k++) {
      const mag = (2 * Math.hypot(re[k], im[k])) / N;
      const db = 20 * Math.log10(mag + 1e-12);
      let v = Math.round(((db - minDb) / (maxDb - minDb)) * 255);
      v = Math.max(0, Math.min(255, v));
      out[k] = smooth ? Math.round(out[k] * 0.8 + v * 0.2) : v;
    }
    return out;
  }

  /* ================== offline DSP graph ==================
   * Mirrors the proven live graph 1:1 (binaural pair, Septōn harmonic
   * pair + monaural AM, decorrelated pink noise, Masaki AM channel,
   * masked affirmation channel) on an OfflineAudioContext. */

  function buildPinkNoise(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
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

  /* Builds the full graph on `ctx` for `state`, returns nothing —
   * everything is scheduled from t=0 to `seconds`.
   * opts.glideFrom {beat, carrier}: ramp osc freqs across the segment.
   * opts.affBuffer + opts.affGain: masked affirmation channel.
   * opts.includeMaster false → cover-only probe render (no volume scaling). */
  function scheduleGraph(ctx, state, seconds, opts = {}) {
    const s = state;
    const t0 = 0;
    const master = ctx.createGain();
    master.gain.value = opts.includeMaster === false ? 1 : s.volume * 0.5;
    master.connect(ctx.destination);

    const merger = ctx.createChannelMerger(2);
    const earGainL = ctx.createGain();
    const earGainR = ctx.createGain();
    earGainL.gain.value = Math.min(1, 1 - s.balance);
    earGainR.gain.value = Math.min(1, 1 + s.balance);
    earGainL.connect(merger, 0, 0);
    earGainR.connect(merger, 0, 1);
    merger.connect(master);

    const toneBusL = ctx.createGain();
    const toneBusR = ctx.createGain();
    toneBusL.gain.value = s.toneLevel;
    toneBusR.gain.value = s.toneLevel;
    toneBusL.connect(earGainL);
    toneBusR.connect(earGainR);

    const from = opts.glideFrom || null;
    const beat0 = from ? from.beat : s.beat;
    const car0 = from ? from.carrier : s.carrier;

    const mkOsc = (f0, f1) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t0);
      if (from) o.frequency.linearRampToValueAtTime(f1, t0 + seconds);
      o.start(t0); o.stop(t0 + seconds);
      return o;
    };

    // primary binaural pair
    mkOsc(car0 - beat0 / 2, s.carrier - s.beat / 2).connect(toneBusL);
    mkOsc(car0 + beat0 / 2, s.carrier + s.beat / 2).connect(toneBusR);

    // Septōn: harmonic pair + monaural AM per ear
    if (s.septon) {
      const gL = ctx.createGain(), gR = ctx.createGain();
      gL.gain.value = 0.25; gR.gain.value = 0.25;
      mkOsc(car0 - beat0, s.carrier - s.beat).connect(gL);
      mkOsc(car0 + beat0, s.carrier + s.beat).connect(gR);
      gL.connect(toneBusL); gR.connect(toneBusR);

      const am = mkOsc(beat0, s.beat);
      const dL = ctx.createGain(), dR = ctx.createGain();
      dL.gain.value = s.monaural * 0.5;
      dR.gain.value = s.monaural * 0.5;
      am.connect(dL); am.connect(dR);
      dL.connect(toneBusL.gain); dR.connect(toneBusR.gain);
    }

    // phased pink-noise bed
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = s.noiseLevel;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buildPinkNoise(ctx, Math.min(4, seconds));
    noiseSrc.loop = true;
    noiseSrc.connect(noiseGain);
    noiseGain.connect(master);

    // Masaki Fm theta AM channel
    if (s.fmOn) {
      const fmOsc = ctx.createOscillator();
      fmOsc.type = 'sine';
      fmOsc.frequency.value = s.fmCarrier;
      const fmCarrierGain = ctx.createGain();
      fmCarrierGain.gain.value = s.fmLevel * (1 - s.fmDepth * 0.5);
      const fmLFO = ctx.createOscillator();
      fmLFO.type = 'sine';
      fmLFO.frequency.setValueAtTime(s.fmRate, t0);
      const fmAMDepth = ctx.createGain();
      fmAMDepth.gain.setValueAtTime(s.fmLevel * s.fmDepth * 0.5, t0);
      // 1/f fluctuation: deterministic wander returning to base at the
      // end of the segment, so loops stay periodic
      if (s.fmOneDivF) {
        let wander = 0, t = 4 + Math.random() * Math.random() * 10;
        while (t < seconds - 3) {
          wander = wander * 0.7 + (Math.random() * 2 - 1) * 0.3;
          const rate = Math.min(10, Math.max(2, s.fmRate * (1 + wander * 0.15)));
          const depth = Math.min(1, Math.max(0.3, s.fmDepth * (1 + wander * 0.1)));
          fmLFO.frequency.setTargetAtTime(rate, t0 + t, 1.2);
          fmAMDepth.gain.setTargetAtTime(s.fmLevel * depth * 0.5, t0 + t, 1.2);
          t += 4 + Math.random() * Math.random() * 10;
        }
        fmLFO.frequency.setTargetAtTime(s.fmRate, t0 + Math.max(0, seconds - 3), 0.8);
        fmAMDepth.gain.setTargetAtTime(s.fmLevel * s.fmDepth * 0.5, t0 + Math.max(0, seconds - 3), 0.8);
      }
      fmLFO.connect(fmAMDepth);
      fmAMDepth.connect(fmCarrierGain.gain);
      fmOsc.connect(fmCarrierGain);
      fmCarrierGain.connect(master);
      fmOsc.start(t0); fmOsc.stop(t0 + seconds);
      fmLFO.start(t0); fmLFO.stop(t0 + seconds);
    }

    // Mikell masked affirmation channel (gain pre-computed by caller)
    if (opts.affBuffer && opts.affGain > 0) {
      const src = ctx.createBufferSource();
      src.buffer = opts.affBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = opts.affGain;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t0); src.stop(t0 + seconds);
    }
  }

  /* ---------- steady-state cover envelope (two-pass, replaces the live
   * envelope follower: the cover mix is statistically stationary, so the
   * follower's output is near-constant — measure it once per render). ---------- */
  async function measureCoverEnv(state) {
    const rate = 11025, secs = 1.6;
    const ctx = newOfflineCtx(2, Math.floor(rate * secs), rate);
    scheduleGraph(ctx, state, secs, { includeMaster: false });
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const start = Math.floor(rate * 0.5); // skip onset
    let sum = 0, n = 0;
    for (let i = start; i < buf.length; i++) { sum += L[i] * L[i] + R[i] * R[i]; n += 2; }
    const rms = Math.sqrt(sum / n);
    return Math.min(1, rms * 5); // same scaling as the live follower
  }

  function affGainFor(state, coverEnv) {
    if (!state.affOn) return 0;
    const floor = 0.015;
    return Math.min(0.5, Math.max(floor, state.affRatio * (0.2 + coverEnv * 1.6)));
  }

  /* ---------- main entry: render a segment ----------
   * opts: { seconds, loop, glideFrom, affBuffer }
   * Returns { buffer(AudioBuffer), coverEnv, affGain }. Loop segments are
   * rendered long and tail-into-head crossfaded for a seamless join. */
  async function renderSegment(state, opts) {
    const seconds = opts.seconds;
    const xf = opts.loop ? SEAM_XFADE : 0;
    const coverEnv = await measureCoverEnv(state);
    const affGain = opts.affBuffer ? affGainFor(state, coverEnv) : 0;

    const ctx = newOfflineCtx(2, Math.ceil((seconds + xf) * RENDER_RATE), RENDER_RATE);
    scheduleGraph(ctx, state, seconds + xf, {
      glideFrom: opts.glideFrom,
      affBuffer: opts.affBuffer && state.affOn ? await transferBuffer(ctx, opts.affBuffer) : null,
      affGain
    });
    const raw = await ctx.startRendering();

    let out = raw;
    if (opts.loop) {
      const N = Math.floor(seconds * RENDER_RATE);
      const Xn = raw.length - N;
      out = ctx.createBuffer(2, N, RENDER_RATE);
      for (let c = 0; c < 2; c++) {
        const src = raw.getChannelData(c);
        const dst = out.getChannelData(c);
        dst.set(src.subarray(0, N));
        for (let i = 0; i < Xn; i++) {           // equal-power tail→head
          const u = i / Xn;
          const gIn = Math.sin((u * Math.PI) / 2);
          const gOut = Math.cos((u * Math.PI) / 2);
          dst[i] = dst[i] * gIn + src[N + i] * gOut;
        }
      }
    }
    return { buffer: out, coverEnv, affGain };
  }

  /* AudioBuffers are bound to a context's sample rate; resample the
   * decoded affirmation into the render context's rate via copy. */
  async function transferBuffer(ctx, buf) {
    if (buf.sampleRate === ctx.sampleRate) return buf;
    const off = newOfflineCtx(buf.numberOfChannels, Math.ceil(buf.duration * ctx.sampleRate), ctx.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0);
    return off.startRendering();
  }

  /* ---------- derive one-shot blobs from an already-rendered loop ----------
   * (intro fade-in / stop fade-out are pure JS envelopes over the loop PCM —
   * no re-render, so they work instantly even mid-session in background) */
  function envelopeBlob(loopBuffer, startPos, seconds, kind, fadeSeconds) {
    const rate = loopBuffer.sampleRate;
    const len = Math.floor(seconds * rate);
    const startI = Math.floor(startPos * rate);
    const chans = [];
    for (let c = 0; c < loopBuffer.numberOfChannels; c++) {
      const src = loopBuffer.getChannelData(c);
      const dst = new Float32Array(len);
      for (let i = 0; i < len; i++) dst[i] = src[(startI + i) % src.length];
      chans.push(dst);
    }
    applyEdgeFade(chans, rate, fadeSeconds, kind);
    return encodeWav({
      numberOfChannels: chans.length,
      length: len,
      sampleRate: rate,
      getChannelData: i => chans[i]
    });
  }

  return {
    RENDER_RATE, SEAM_XFADE,
    snapLoopSeconds, encodeWav, applyEdgeFade, fftByteSpectrum,
    renderSegment, envelopeBlob, affGainFor
  };
})();

if (typeof window !== 'undefined') window.RenderCore = RenderCore;
if (typeof module !== 'undefined' && module.exports) module.exports = RenderCore;
