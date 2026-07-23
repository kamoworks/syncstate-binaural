/* ============================================================
 * SyncState Media Transport
 * Media-element playback is what iOS lets continue when the
 * screen locks or the app is backgrounded; live Web Audio is
 * suspended (docs/RESEARCH-IOS-BACKGROUND-AUDIO-2026-07-23.md).
 * Also owns the Media Session (lock-screen card + controls).
 *
 * v2: TWO audio elements in a ping-pong arrangement. On-device
 * testing (iPhone 13, iOS 26.3.1) showed native <audio loop>
 * drops ~1 s of audio at every wrap — the documented iOS gapless
 * regression. Instead, loops play as one-shots and the preloaded
 * standby element starts a fraction before the active one ends;
 * an 'ended' listener is the backstop when timers are throttled
 * in the background (worst case: a brief gap once per loop,
 * ~2.5 min, instead of every 20 s).
 * ============================================================ */

class MediaTransport {
  constructor({ onExternalPause, onExternalPlay } = {}) {
    this.a = this._makeEl();
    this.b = this._makeEl();
    this._active = this.a;
    this._standby = this.b;

    this._urls = new Set();
    this._loopUrl = null;       // url both elements ping-pong over
    this._loopMode = false;
    this._handoffTimer = null;
    this._onLoopStart = null;   // fired once, when the first handoff lands
    this._onEnded = null;       // playOnce chaining
    this._unlocked = false;
    this._swapping = false;
    this.shouldBePlaying = false;
    this.onExternalPause = onExternalPause || null;
    this.onExternalPlay = onExternalPlay || null;
    this.ontimeupdate = null;

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

  _wire(el) {
    el.addEventListener('ended', () => {
      if (el !== this._active) return;
      if (this._loopMode) {
        this._doHandoff();      // backstop: early-start timer didn't fire
      } else {
        const fn = this._onEnded;
        this._onEnded = null;
        fn && fn();
      }
    });
    el.addEventListener('timeupdate', () => {
      if (el !== this._active) return;
      if (this._loopMode) this._armHandoff();
      this.ontimeupdate && this.ontimeupdate();
    });
    // Interruptions (calls, Siri, other media apps) pause the element
    // directly — surface that so the UI stays truthful.
    el.addEventListener('pause', () => {
      if (el !== this._active) return;
      if (this.shouldBePlaying && !el.ended && !this._swapping) {
        this.onExternalPause && this.onExternalPause();
      }
      this._setSessionState('paused');
    });
    el.addEventListener('play', () => {
      if (el !== this._active) return;
      if (!this._swapping) this.onExternalPlay && this.onExternalPlay();
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

  hasSource() { return !!this._loopUrl || !!this._active.src; }

  _mkUrl(blob) {
    const url = URL.createObjectURL(blob);
    this._urls.add(url);
    return url;
  }

  _revokeAllExcept(keep) {
    for (const u of this._urls) {
      if (!keep.includes(u)) { URL.revokeObjectURL(u); this._urls.delete(u); }
    }
  }

  _clearHandoff() {
    clearTimeout(this._handoffTimer);
    this._handoffTimer = null;
  }

  /* ---------- gapless loop machinery ---------- */

  _prepStandby(url, startPos) {
    const el = this._standby;
    const seek = () => { try { el.currentTime = startPos; } catch (e) {} };
    if (el.src !== url) {
      el.src = url;
      el.load();
      el.addEventListener('loadedmetadata', seek, { once: true });
    } else if (el.readyState >= 1) {
      seek();
    } else {
      el.addEventListener('loadedmetadata', seek, { once: true });
    }
  }

  _armHandoff() {
    if (this._handoffTimer) return;
    const el = this._active;
    if (!el.duration || !isFinite(el.duration)) return;
    const remain = el.duration - el.currentTime;
    if (remain <= 1.5) {
      // start the standby a fraction early: a ~150 ms overlap of the
      // crossfaded seam is far less audible than iOS's native loop gap
      this._handoffTimer = setTimeout(() => this._doHandoff(), Math.max(0, (remain - 0.15) * 1000));
    }
  }

  _doHandoff() {
    this._clearHandoff();
    if (!this._loopMode || !this.shouldBePlaying) return;
    const oldEl = this._active;
    const newEl = this._standby;
    const p = newEl.play();
    if (p && p.catch) p.catch(() => {});
    this._active = newEl;
    this._standby = oldEl;
    const onLoop = this._onLoopStart;
    this._onLoopStart = null;
    onLoop && onLoop();
    setTimeout(() => {
      oldEl.pause();
      this._prepStandby(this._loopUrl, 0);  // ready for the next wrap
      this._revokeAllExcept([this._loopUrl]);
    }, 400);
  }

  async _playActive(position) {
    this._swapping = true;
    const el = this._active;
    try {
      if (position) {
        await new Promise(res => {
          if (el.readyState >= 1) return res();
          el.addEventListener('loadedmetadata', res, { once: true });
        });
        try { el.currentTime = position; } catch (e) {}
      }
      await el.play();
    } catch (e) {
      /* recovered by watchdog */
    } finally {
      this._swapping = false;
    }
  }

  /* ---------- public transport API ---------- */

  /* Endless seamless loop of `blob`, starting at `position`. */
  playLoop(blob, position = 0) {
    this._clearHandoff();
    this._onEnded = null;
    this._loopMode = true;
    this.shouldBePlaying = true;
    this._loopUrl = this._mkUrl(blob);
    this._active.loop = false;
    this._active.src = this._loopUrl;
    this._prepStandby(this._loopUrl, 0);
    return this._playActive(position).then(() => this._revokeAllExcept([this._loopUrl]));
  }

  /* One-shot `firstBlob` (intro fade-in / stage glide) handed off
   * seamlessly into an endless loop of `loopBlob`. `loopStart` is where
   * the loop picks up after the first handoff (for content continuity). */
  playThenLoop(firstBlob, loopBlob, { loopStart = 0, onLoop = null } = {}) {
    this._clearHandoff();
    this._onEnded = null;
    this._loopMode = true;
    this.shouldBePlaying = true;
    const firstUrl = this._mkUrl(firstBlob);
    this._loopUrl = this._mkUrl(loopBlob);
    this._onLoopStart = onLoop;
    this._active.loop = false;
    this._active.src = firstUrl;
    this._prepStandby(this._loopUrl, loopStart);
    return this._playActive(0);
  }

  /* Plain one-shot (stop fade / timer fade) — no looping. */
  playOnce(blob, onEnded) {
    this._clearHandoff();
    this._loopMode = false;
    this._onLoopStart = null;
    this._onEnded = onEnded || null;
    this.shouldBePlaying = true;
    const url = this._mkUrl(blob);
    this._standby.pause();
    this._active.loop = false;
    this._active.src = url;
    return this._playActive(0).then(() => this._revokeAllExcept([url]));
  }

  pause() {
    this.shouldBePlaying = false;
    this._clearHandoff();
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
    this._loopMode = false;
    this._onEnded = null;
    this._onLoopStart = null;
    this._clearHandoff();
    for (const el of [this.a, this.b]) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this._loopUrl = null;
    this._revokeAllExcept([]);
    this._setSessionState('none');
  }

  recover() {
    if (this.shouldBePlaying && this._active.paused) {
      const p = this._active.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  position() { return this._active.currentTime || 0; }

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
