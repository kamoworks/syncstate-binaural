/* ============================================================
 * SyncState Media Transport
 * Single hidden <audio> element = the ONLY sound path during a
 * session. Media-element playback is what iOS lets continue when
 * the screen locks or the app is backgrounded; live Web Audio is
 * suspended (docs/RESEARCH-IOS-BACKGROUND-AUDIO-2026-07-23.md).
 * Also owns the Media Session (lock-screen card + controls).
 * ============================================================ */

class MediaTransport {
  constructor({ onExternalPause, onExternalPlay } = {}) {
    this.el = document.createElement('audio');
    this.el.preload = 'auto';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);

    this._url = null;
    this._unlocked = false;
    this.shouldBePlaying = false;
    this._onEnded = null;
    this.onExternalPause = onExternalPause || null;
    this.onExternalPlay = onExternalPlay || null;
    this.ontimeupdate = null;

    // The sanctioned lever for background/silent-switch playback
    // (W3C Audio Session API, Safari 16.4+).
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}

    this.el.addEventListener('ended', () => {
      const fn = this._onEnded;
      this._onEnded = null;
      fn && fn();
    });
    this.el.addEventListener('timeupdate', () => {
      this.ontimeupdate && this.ontimeupdate();
    });
    // Interruptions (calls, Siri, other media apps) pause the element
    // directly — surface that so the UI stays truthful.
    this.el.addEventListener('pause', () => {
      if (this.shouldBePlaying && !this.el.ended && !this._swapping) {
        this.onExternalPause && this.onExternalPause();
      }
      this._setSessionState('paused');
    });
    this.el.addEventListener('play', () => {
      if (!this._swapping) this.onExternalPlay && this.onExternalPlay();
      this._setSessionState('playing');
    });

    // Watchdog: if iOS paused us while backgrounded, recover on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.recover();
    });
  }

  /* Must be called synchronously inside the FIRST user gesture: playing a
   * tiny silent WAV "blesses" the element so all later programmatic
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
    this.el.src = URL.createObjectURL(silent);
    this.el.loop = false;
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }

  hasSource() { return !!this._url; }

  _swap(blob) {
    this._swapping = true;
    const old = this._url;
    this._url = URL.createObjectURL(blob);
    this.el.src = this._url;
    if (old) URL.revokeObjectURL(old);
  }

  async _playWhenReady(position) {
    try {
      if (position) {
        await new Promise(res => {
          if (this.el.readyState >= 1) return res();
          this.el.addEventListener('loadedmetadata', res, { once: true });
        });
        try { this.el.currentTime = position; } catch (e) {}
      }
      await this.el.play();
    } catch (e) {
      /* recovered by watchdog */
    } finally {
      this._swapping = false;
    }
  }

  playLoop(blob, position = 0) {
    this._onEnded = null;
    this.el.loop = true;
    this.shouldBePlaying = true;
    this._swap(blob);
    return this._playWhenReady(position);
  }

  playOnce(blob, onEnded) {
    this._onEnded = onEnded || null;
    this.el.loop = false;
    this.shouldBePlaying = true;
    this._swap(blob);
    return this._playWhenReady(0);
  }

  pause() {
    this.shouldBePlaying = false;
    this.el.pause();
  }

  resume() {
    if (!this._url) return;
    this.shouldBePlaying = true;
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  }

  stop() {
    this.shouldBePlaying = false;
    this._onEnded = null;
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    this._setSessionState('none');
  }

  recover() {
    if (this.shouldBePlaying && this.el.paused && this._url) {
      const p = this.el.play();
      if (p && p.catch) p.catch(() => {});
    }
  }

  position() { return this.el.currentTime || 0; }

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
