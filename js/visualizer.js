/* ============================================================
 * SyncState Visualizer
 * Renders: (1) left/right ear waveforms + perceived beat envelope,
 * (2) live spectrum from the audio analyser,
 * (3) brainwave band marker. Canvas-based, 60fps, battery-aware.
 * ============================================================ */

class Visualizer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.ctx2d = canvas.getContext('2d');
    this.running = false;
    this.phase = 0;
    this._spectrum = new Uint8Array(1024);
    this._raf = null;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.dpr = dpr;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this._draw();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _draw() {
    const c = this.ctx2d;
    const W = this.canvas.width, H = this.canvas.height;
    const s = this.engine.state;
    const playing = this.engine.running && !this.engine.paused;

    c.clearRect(0, 0, W, H);

    // background glow keyed to current band
    const band = bandFor(s.beat);
    const grad = c.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.4, W * 0.7);
    grad.addColorStop(0, band.color + (playing ? '26' : '12'));
    grad.addColorStop(1, 'transparent');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);

    this.phase += playing ? 0.045 + s.beat * 0.002 : 0.004;

    // ---- section 1: ear waveforms + beat envelope (top 55%) ----
    const waveH = H * 0.5;
    const midY = waveH / 2;
    const amp = waveH * 0.28 * (playing ? 1 : 0.35);

    // carrier visually scaled so beats are visible (display-only mapping)
    const carrierVis = 14;
    const beatVis = Math.max(1.2, s.beat * 0.5);

    // envelope of the perceived binaural beat
    c.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const env = Math.abs(Math.cos((x / W) * Math.PI * beatVis + this.phase * 0.6));
      const y = midY - amp * env;
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.strokeStyle = band.color + '55';
    c.lineWidth = 1.5 * this.dpr;
    c.stroke();

    // left ear wave
    this._wave(c, W, midY, amp, carrierVis, beatVis, this.phase, '#8ab4ff', playing);
    // right ear wave (slightly detuned)
    this._wave(c, W, midY, amp, carrierVis, beatVis, this.phase * 1.02 + 0.7, '#f0a6c0', playing);

    // ---- section 2: live spectrum (bottom 32%) ----
    const specTop = H * 0.62;
    const specH = H * 0.34;
    const analyser = this.engine.getAnalyser();
    if (analyser && playing) {
      analyser.getByteFrequencyData(this._spectrum);
      const bins = 96;
      const bw = W / bins;
      for (let i = 0; i < bins; i++) {
        // focus on low frequencies where carriers live
        const v = this._spectrum[Math.floor(i * 3)] / 255;
        const h = Math.max(2, v * specH);
        c.fillStyle = band.color + 'aa';
        c.fillRect(i * bw + 1, specTop + specH - h, bw - 2, h);
      }
    } else {
      c.fillStyle = 'rgba(255,255,255,0.06)';
      const bins = 96, bw = W / bins;
      for (let i = 0; i < bins; i++) {
        const h = (Math.sin(i * 0.3) * 0.5 + 0.5) * specH * 0.15 + 3;
        c.fillRect(i * bw + 1, specTop + specH - h, bw - 2, h);
      }
    }

    // ---- band tick marks ----
    c.font = `${10 * this.dpr}px -apple-system, sans-serif`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.textAlign = 'center';
    BANDS.forEach(b => {
      c.fillStyle = b.name === band.name ? b.color : 'rgba(255,255,255,0.35)';
      c.fillText(b.name, this._bandX(b, W), H - 8 * this.dpr);
    });
    // marker
    const mx = this._freqX(s.beat, W);
    c.beginPath();
    c.moveTo(mx, H - 24 * this.dpr);
    c.lineTo(mx - 5 * this.dpr, H - 32 * this.dpr);
    c.lineTo(mx + 5 * this.dpr, H - 32 * this.dpr);
    c.closePath();
    c.fillStyle = band.color;
    c.fill();
  }

  _wave(c, W, midY, amp, carrierVis, beatVis, phase, color, playing) {
    c.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const u = x / W;
      const env = Math.cos(u * Math.PI * beatVis + phase * 0.6);
      const y = midY + Math.sin(u * Math.PI * carrierVis + phase) * amp * (0.35 + 0.65 * Math.abs(env));
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.strokeStyle = playing ? color : color + '55';
    c.lineWidth = 1.6 * this.dpr;
    c.stroke();
  }

  _freqX(f, W) {
    // log scale 0.5 .. 45 Hz across width with padding
    const min = Math.log(0.5), max = Math.log(45);
    const u = (Math.log(Math.max(0.5, Math.min(45, f))) - min) / (max - min);
    return W * (0.08 + u * 0.84);
  }

  _bandX(b, W) {
    return this._freqX(Math.sqrt(b.min * b.max), W);
  }
}

window.Visualizer = Visualizer;
