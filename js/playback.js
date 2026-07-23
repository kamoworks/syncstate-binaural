/* ============================================================
 * SyncState Media Transport
 * Media-element playback is what iOS lets continue when the
 * screen locks or the app is backgrounded; live Web Audio is
 * suspended (docs/RESEARCH-IOS-BACKGROUND-AUDIO-2026-07-23.md).
 * Also owns the Media Session (lock-screen card + controls).
 *
 * v3 (SPEC-V3 Pillar 1): ONE seamless path for every change.
 * Two <audio> elements; whatever needs to play next — a loop
 * wrap, a re-rendered loop after a slider change, an intro or
 * stage glide, even a stop fade — is prepped on the standby
 * element and brought in with a short overlap while the old
 * element retires. Loop wraps are driven by the media clock
 * (timeupdate) with the 'ended' event as backstop; setTimeout is
 * never trusted for timing (background throttling, see
 * docs/RESEARCH-MEDIASESSION-BACKGROUND-2026-07-23.md).
 * ============================================================ */

class MediaTransport {
  constructor({ onExternalPause, onExternalPlay } = {}) {
    this.a = this._makeEl();
    this.b = this._makeEl();
    this._active = this.a;
    this._standby = this.b;

    this._urls = new Set();
    this._nextUrl = null;       // plays after active ends (null = one-shot)
    this._nextStart = 0;        // offset for the FIRST entry into _nextUrl
    this._onNext = null;        // fired once when _nextUrl takes over
    this._onEnded = null;       // one-shot completion callback
    this._handingOff = false;
    this._retireTimer = null;
    this._unlocked = false;
    this.shouldBePlaying = false;
    this.onswap = null;         // active element changed (re-anchor Media Session)
    this.onExternalPause = onExternalPause || null;
    this.onExternalPlay = onExternalPlay || null;
    this.ontimeupdate = null;

    // iOS ignores element.volume (hardware buttons only); detect once so the
    // engine knows whether volume can be live or must be baked into renders.
    this.volumeWritable = this._detectVolume();

    // The sanctioned lever for background/silent-switch playback
    // (W3C Audio Session API, Safari 16.4+).
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}

    for (const el of [this.a, this.b]) this._wire(el);

    // Watchdog: if iOS paused us while backgrounded, recover on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.recover();
    });
  }

  _makeEl() {
    const el = document.createElement('audio');
    el.preload = 'auto';
    el.style.display = 'none';
    document.body.appendChild(el);
    return el;
  }

  _detectVolume() {
    try {
      this.a.volume = 0.43;
      const ok = Math.abs(this.a.volume - 0.43) < 0.01;
      this.a.volume = 1;
      return ok;
    } catch (e) { return false; }
  }

  setVolume(v) {
    if (!this.volumeWritable) return;
    this.a.volume = v;
    this.b.volume = v;
  }

  _wire(el) {
    el.addEventListener('ended', () => {
      if (el !== this._active) return;
      if (this._nextUrl) {
        this._handoff();        // backstop: media-clock trigger missed the seam
      } else {
        const fn = this._onEnded;
        this._onEnded = null;
        fn && fn();
      }
    });
    el.addEventListener('timeupdate', () => {
      if (el !== this._active) return;
      if (this._nextUrl && !this._handingOff && el.duration && isFinite(el.duration)
          && el.duration - el.currentTime <= 0.35) {
        this._handoff();        // primary trigger: the media clock itself
      }
      this.ontimeupdate && this.ontimeupdate();
    });
    // Interruptions (calls, Siri, other media apps) pause the element
    // directly — surface that so the UI stays truthful.
    el.addEventListener('pause', () => {
      if (el !== this._active) return;
      if (this.shouldBePlaying && !el.ended && !this._handingOff) {
        this.onExternalPause && this.onExternalPause();
      }
      this._setSessionState('paused');
    });
    el.addEventListener('play', () => {
      if (el !== this._active) return;
      this.onExternalPlay && this.onExternalPlay();
      this._setSessionState('playing');
    });
  }

  /* Must be called synchronously inside the FIRST user gesture: playing a
   * tiny silent WAV "blesses" both elements so all later programmatic
   * play()/src swaps are allowed (the standard iOS playlist pattern —
   * renders finish after the transient-activation window has expired). */
  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    const silent = RenderCore.encodeWav({
      numberOfChannels: 1,
      length: 400,
      sampleRate: 8000,
      getChannelData: () => new Float32Array(400)
    });
    for (const el of [this.a, this.b]) {
      el.src = URL.createObjectURL(silent);
      el.loop = false;
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  hasSource() { return !!this._nextUrl || !!this._active.src; }

  position() { return this._active.currentTime || 0; }

  _mkUrl(blob) {
    const url = URL.createObjectURL(blob);
    this._urls.add(url);
    return url;
  }

  _gc() {
    const keep = [this._active.src, this._standby.src, this._nextUrl];
    for (const u of this._urls) {
      if (!keep.includes(u)) { URL.revokeObjectURL(u); this._urls.delete(u); }
    }
  }

  /* Load `url` into `el`, seek to `pos` once metadata allows, then `ready()`. */
  _prepFor(el, url, pos, ready) {
    const go = () => {
      if (pos) { try { el.currentTime = pos; } catch (e) {} }
      ready && ready();
    };
    if (el.src !== url) {
      el.src = url;
      el.load();
      if (!pos) return go();    // play() queues until data arrives
      el.addEventListener('loadedmetadata', go, { once: true });
    } else if (el.readyState >= 1 || !pos) {
      go();
    } else {
      el.addEventListener('loadedmetadata', go, { once: true });
    }
  }

  _prepStandby(url, startPos) {
    this._prepFor(this._standby, url, startPos, null);
    if (!startPos) { try { this._standby.currentTime = 0; } catch (e) {} }
  }

  /* Seam/next handoff: the prepped standby takes over with a short overlap. */
  _handoff() {
    if (this._handingOff || !this._nextUrl || !this.shouldBePlaying) return;
    this._handingOff = true;
    const oldEl = this._active;
    const newEl = this._standby;
    if (newEl.src !== this._nextUrl) newEl.src = this._nextUrl; // late-prep fallback
    const p = newEl.play();
    if (p && p.catch) p.catch(() => {});
    this._active = newEl;
    this._standby = oldEl;
    this._nextStart = 0;        // only the first entry uses a custom offset
    const fired = this._onNext;
    this._onNext = null;
    fired && fired();
    this.onswap && this.onswap();
    clearTimeout(this._retireTimer);
    this._retireTimer = setTimeout(() => {
      oldEl.pause();
      if (this._nextUrl) this._prepStandby(this._nextUrl, 0);
      this._gc();
      this._handingOff = false;
    }, 400);
  }

  /* Core: play `url` — seamlessly handed off from whatever is audible now.
   * nextUrl/nextStart/onNext queue what follows (loop wraps chain to self). */
  _engage(url, { position = 0, nextUrl = null, nextStart = 0, onNext = null, onEnded = null } = {}) {
    clearTimeout(this._retireTimer);
    this._handingOff = false;
    this._onEnded = onEnded;
    this._onNext = onNext;
    this._nextUrl = nextUrl;
    this._nextStart = nextStart;
    const wasAudible = this.shouldBePlaying && this._active.src && !this._active.paused;
    this.shouldBePlaying = true;

    if (wasAudible) {
      const newEl = this._standby;
      this._prepFor(newEl, url, position, () => {
        if (!this.shouldBePlaying) return;   // stopped while loading
        const oldEl = this._active;
        const p = newEl.play();
        if (p && p.catch) p.catch(() => {});
        this._active = newEl;
        this._standby = oldEl;
        this.onswap && this.onswap();
        this._retireTimer = setTimeout(() => {
          oldEl.pause();
          if (this._nextUrl) this._prepStandby(this._nextUrl, this._nextStart);
          this._gc();
        }, 350);
      });
    } else {
      const el = this._active;
      this._prepFor(el, url, position, () => {
        if (!this.shouldBePlaying) return;
        const p = el.play();
        if (p && p.catch) p.catch(() => {});
        if (this._nextUrl) this._prepStandby(this._nextUrl, this._nextStart);
        this._gc();
        this.onswap && this.onswap();
      });
    }
  }

  /* ---------- public transport API ---------- */

  /* Endless seamless loop, starting at `position`. Seamless takeover if
   * something is already playing (param changes, preset switches). */
  playLoop(blob, position = 0) {
    const url = this._mkUrl(blob);
    this._engage(url, { position, nextUrl: url });
  }

  /* One-shot `firstBlob` (intro fade-in / stage glide) chained seamlessly
   * into an endless loop of `loopBlob`, which enters at `loopStart`. */
  playThenLoop(firstBlob, loopBlob, { loopStart = 0, onLoop = null } = {}) {
    const firstUrl = this._mkUrl(firstBlob);
    const loopUrl = this._mkUrl(loopBlob);
    this._engage(firstUrl, { nextUrl: loopUrl, nextStart: loopStart, onNext: onLoop });
  }

  /* Plain one-shot (stop fade / timer fade) — blends in, then ends. */
  playOnce(blob, onEnded) {
    const url = this._mkUrl(blob);
    this._engage(url, { onEnded });
  }

  pause() {
    this.shouldBePlaying = false;
    this._active.pause();
  }

  resume() {
    if (!this.hasSource()) return;
    this.shouldBePlaying = true;
    const p = this._active.play();
    if (p && p.catch) p.catch(() => {});
  }

  stop() {
    this.shouldBePlaying = false;
    this._nextUrl = null;
    this._onNext = null;
    this._onEnded = null;
    this._handingOff = false;
    clearTimeout(this._retireTimer);
    for (const el of [this.a, this.b]) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    for (const u of this._urls) URL.revokeObjectURL(u);
    this._urls.clear();
    this._setSessionState('none');
  }

  recover() {
    if (this.shouldBePlaying && this._active.paused) {
      const p = this._active.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  /* ---------- Media Session: lock-screen card + controls ---------- */

  initMediaSession({ onPlay, onPause, onStop }) {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const safe = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (e) {} };
    safe('play', () => onPlay && onPlay());
    safe('pause', () => onPause && onPause());
    safe('stop', () => onStop && onStop());
  }

  setNowPlaying(title, subtitle, color) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Binaural Session',
        artist: 'SyncState',
        album: subtitle || 'Binaural Consciousness Studio',
        artwork: [{ src: this._artwork(color || '#3ecfae'), sizes: '512x512', type: 'image/png' }]
      });
    } catch (e) {}
  }

  /* Session progress for the lock-screen timeline. Must be re-published
   * after every src change/handoff (the engine hooks onswap for that). */
  setPosition(elapsedSec, totalSec) {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!isFinite(totalSec) || totalSec <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: totalSec,
        position: Math.max(0, Math.min(totalSec, elapsedSec)),
        playbackRate: 1
      });
    } catch (e) {}
  }

  _setSessionState(state) {
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
    } catch (e) {}
  }

  /* Lock-screen artwork, tinted to the active brainwave band. */
  _artwork(color) {
    if (this._artCache && this._artCache.color === color) return this._artCache.url;
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0e1a';
    g.fillRect(0, 0, 512, 512);
    const grad = g.createRadialGradient(256, 256, 40, 256, 256, 300);
    grad.addColorStop(0, color + '66');
    grad.addColorStop(1, 'transparent');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(256, 256, 150, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();                              // sine glyph across the ring
    for (let x = -140; x <= 140; x += 4) {
      const y = 256 + Math.sin((x / 140) * Math.PI * 2) * 46;
      x === -140 ? g.moveTo(256 + x, y) : g.lineTo(256 + x, y);
    }
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.stroke();
    const url = c.toDataURL('image/png');
    this._artCache = { color, url };
    return url;
  }
}

window.MediaTransport = MediaTransport;
