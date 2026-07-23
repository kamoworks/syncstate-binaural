/* ============================================================
 * SyncState Affirmations — Mikell US 5,245,666 implementation
 *  - Affirm Studio: record with live level meter + elapsed time,
 *    review before saving (play solo / re-record / discard)
 *  - My Recordings: IndexedDB-persisted takes — select, solo
 *    preview, rename, delete with undo
 *  - Curated affirmation library (shown in full — no hidden text)
 *  - Liminal calibration + live masking meters
 *
 * Capture choreography + platform specifics:
 *   docs/SPEC-AFFIRM-STUDIO-2026-07-23.md
 *   docs/RESEARCH-IOS-MIC-AUDIOSESSION-2026-07-23.md
 *   docs/RESEARCH-RECORDING-UX-STORAGE-2026-07-23.md
 * ============================================================ */

/* Library files are stored as base64 text (.b64) so they can ship
 * through text-only hosting pipelines; decoded to audio on-device. */
async function fetchB64(url) {
  const text = await (await fetch(url)).text();
  const bin = atob(text.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const AFFIRM_LIBRARY = [
  { id: 'calm', name: 'Calm', glyphBeat: 10, file: 'assets/affirmations/calm.b64',
    text: '“I am calm and relaxed. My mind is clear, and at peace. I breathe deeply, and let go.”' },
  { id: 'focus', name: 'Focus', glyphBeat: 16, file: 'assets/affirmations/focus.b64',
    text: '“I am focused and attentive. My concentration is sharp and steady. I work with clarity and purpose.”' },
  { id: 'confidence', name: 'Confidence', glyphBeat: 12, file: 'assets/affirmations/confidence.b64',
    text: '“I am confident and capable. I trust myself completely. I handle challenges with strength and ease.”' },
  { id: 'sleep', name: 'Sleep', glyphBeat: 2, file: 'assets/affirmations/sleep.b64',
    text: '“I release the day. My body grows heavy and calm. I drift easily into deep, restful sleep.”' }
];

const REC_MAX_SEC = 90;
const REC_MIN_SEC = 1;
const UNDO_MS = 7000;

/* ---------- IndexedDB: recordings survive reloads ---------- */
const RecDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('syncstate-audio', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recordings', { keyPath: 'id' });
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  _tx(mode, fn) {
    return this.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction('recordings', mode);
      const out = fn(tx.objectStore('recordings'));
      tx.oncomplete = () => res(out && out.result);
      tx.onerror = () => rej(tx.error);
    }));
  },
  all() { return this._tx('readonly', s => s.getAll()); },
  get(id) { return this._tx('readonly', s => s.get(id)); },
  put(rec) { return this._tx('readwrite', s => s.put(rec)); },
  remove(id) { return this._tx('readwrite', s => s.delete(id)); }
};

const affirm = {
  recorder: null,
  stream: null,
  chunks: [],
  startTime: 0,
  recTimer: null,
  meterCtx: null,
  meterSrc: null,
  meterRaf: null,
  pendingTake: null,
  recordings: [],
  pendingDelete: null,     // { rec, timer }
  previewUrl: null,
  previewResume: false,
  activeId: null,
  meterTimer: null
};

function affirmInit(engine, $, $$) {

  const previewEl = new Audio();
  previewEl.preload = 'auto';

  /* ================= library ================= */

  const list = $('#affList');
  AFFIRM_LIBRARY.forEach(a => {
    const el = document.createElement('button');
    el.className = 'preset-card aff-card';
    el.dataset.aff = a.id;
    el.innerHTML = `
      ${waveGlyph(a.glyphBeat)}
      <span class="preset-body">
        <span class="preset-name">${a.name}</span>
        <span class="preset-desc aff-text">${a.text}</span>
      </span>
      <span class="aff-play-ind">▶</span>`;
    el.addEventListener('click', async () => {
      if (affirm.activeId === a.id) {
        deselectAffirmation();
        return;
      }
      updateAffStatus('Loading…');
      const ab = await fetchB64(a.file).catch(() => null);
      const ok = ab ? await engine.loadAffirmation(ab) : false;
      if (!ok) { updateAffStatus('Could not load this affirmation — try again'); return; }
      selectAffirmation(a.id, `Playing “${a.name}” — tap the card again to stop`);
    });
    list.appendChild(el);
  });

  function selectAffirmation(id, statusMsg) {
    stopPreview();
    affirm.activeId = id;
    refreshCardStates();
    if (!engine.state.affOn) {
      engine.setAffirmationOn(true);
      $('#affToggle').checked = true;
    }
    updateAffStatus(statusMsg);
    if (!app.playing) togglePlay(); // need the cover mix running
    startMeters();
  }

  function deselectAffirmation() {
    engine.clearAffirmation();
    affirm.activeId = null;
    $('#affToggle').checked = false;
    refreshCardStates();
    updateAffStatus('Stopped — tap any affirmation to start again');
  }

  /* active card shows a stop glyph; inactive cards show play */
  function refreshCardStates() {
    $$('.aff-card').forEach(c => {
      const active = c.dataset.aff === affirm.activeId;
      c.classList.toggle('active', active);
      const ind = c.querySelector('.aff-play-ind');
      if (ind) ind.textContent = active ? '✕' : '▶';
    });
  }

  /* ================= Affirm Studio: recording ================= */

  const scriptEl = $('#affScript');
  scriptEl.value = localStorage.getItem('syncstate-script') || '';
  scriptEl.addEventListener('input', () => localStorage.setItem('syncstate-script', scriptEl.value));

  function studioState(state) {
    $('#studioIdle').hidden = state !== 'idle';
    $('#studioLive').hidden = state !== 'rec';
    $('#studioReview').hidden = state !== 'review';
  }

  /* Every failure gets a SPECIFIC message (the old single generic message
   * hid the real audio-session bug for a full device round). */
  function micErrorMessage(e) {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      return 'This browser has no microphone API here (HTTPS required).';
    }
    switch (e && e.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Microphone blocked. In Safari: tap ᴀA in the address bar → Website Settings → Microphone → Allow, then try again.';
      case 'NotFoundError':
        return 'No microphone was found on this device.';
      case 'NotReadableError':
        return 'The microphone is busy in another app — close it and try again.';
      case 'AbortError':
        return 'The microphone stopped unexpectedly — try again.';
      default:
        return `Could not start recording (${(e && e.name) || 'unknown error'}) — try again.`;
    }
  }

  async function getMicStream() {
    const md = navigator.mediaDevices;
    try {
      // voice-processing off = cleaner voice + avoids iOS ducking modes
      return await md.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (e) {
      if (e && e.name === 'NotAllowedError') throw e;
      return md.getUserMedia({ audio: true }); // constraints not supported
    }
  }

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    return ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function startRecording() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !window.MediaRecorder) {
      recStatus(micErrorMessage(null));
      return;
    }
    stopPreview();
    recStatus('Waiting for microphone permission…');
    // create/resume the meter context NOW, inside the tap gesture —
    // after the getUserMedia await iOS may refuse to start it
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!affirm.meterCtx) affirm.meterCtx = new AC();
      affirm.meterCtx.resume().catch(() => {});
    } catch (e) {}
    // MUST precede getUserMedia: switches the audio session to a
    // record-capable type and pauses the mix (restored afterwards)
    engine.beginCapture();
    let stream;
    try {
      stream = await getMicStream();
    } catch (e) {
      engine.endCapture();
      engine.resumeAfterCapture();
      recStatus(micErrorMessage(e));
      return;
    }
    affirm.stream = stream;
    affirm.chunks = [];
    const mime = pickMime();
    try {
      affirm.recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      affirm.recorder = new MediaRecorder(stream);
    }
    affirm.recorder.ondataavailable = e => { if (e.data && e.data.size) affirm.chunks.push(e.data); };
    affirm.recorder.onstop = finalizeTake;
    // mic revoked mid-take (control center, another app) → treat as stop
    stream.getAudioTracks().forEach(t => { t.onended = () => stopRecording(); });
    affirm.recorder.start();
    affirm.startTime = Date.now();
    startLevelMeter(stream);
    studioState('rec');
    recStatus(app.playing || engine._captureResume
      ? 'Recording — session paused while the mic is open'
      : 'Recording — read your script calmly');
    $('#recLimit').hidden = true;
    clearInterval(affirm.recTimer);
    affirm.recTimer = setInterval(() => {
      const sec = (Date.now() - affirm.startTime) / 1000;
      const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      $('#recTimer').textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (sec >= REC_MAX_SEC - 10) $('#recLimit').hidden = false;
      if (sec >= REC_MAX_SEC) stopRecording();
    }, 200);
  }

  function stopRecording() {
    if (!affirm.recorder || affirm.recorder.state === 'inactive') return;
    try { affirm.recorder.stop(); } catch (e) { finalizeTake(); }
  }

  async function finalizeTake() {
    clearInterval(affirm.recTimer);
    stopLevelMeter();
    const dur = (Date.now() - affirm.startTime) / 1000;
    if (affirm.stream) affirm.stream.getTracks().forEach(t => t.stop());
    affirm.stream = null;
    engine.endCapture();  // restore the playback session type immediately
    const type = (affirm.recorder && affirm.recorder.mimeType) || 'audio/mp4';
    const blob = new Blob(affirm.chunks, { type });
    affirm.recorder = null;
    if (dur < REC_MIN_SEC || blob.size < 1000) {
      engine.resumeAfterCapture();
      studioState('idle');
      recStatus('Too short — speak for a few seconds and try again.');
      return;
    }
    // process NOW: silent-channel downmix (iPhone mics often record stereo
    // with one dead channel → one-eared playback), trim, normalize. The
    // review preview and the saved file are both the processed take.
    recStatus('Processing your take…');
    let processed = null;
    try { processed = await engine.processVoiceBlob(blob); } catch (e) { processed = null; }
    if (!processed) {
      engine.resumeAfterCapture();
      studioState('idle');
      recStatus('That take came out silent — try again a little closer to the mic.');
      return;
    }
    affirm.pendingTake = processed;   // { buffer, wavBlob, duration }
    $('#takeDur').textContent = fmtDur(processed.duration);
    $('#takePlay').textContent = '▶';
    studioState('review');
    recStatus('Listen to your take, then save it or record again.');
  }

  /* live input level while recording (analysis only, never audible) */
  function startLevelMeter(stream) {
    try {
      if (!affirm.meterCtx) return;   // created in the record tap gesture
      affirm.meterSrc = affirm.meterCtx.createMediaStreamSource(stream);
      const an = affirm.meterCtx.createAnalyser();
      an.fftSize = 512;
      affirm.meterSrc.connect(an);
      const buf = new Float32Array(an.fftSize);
      const bar = $('#recMeter');
      const loop = () => {
        if (!affirm.meterSrc) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        bar.style.width = Math.min(100, Math.sqrt(sum / buf.length) * 320) + '%';
        affirm.meterRaf = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) { /* meter is cosmetic — never block recording on it */ }
  }

  function stopLevelMeter() {
    cancelAnimationFrame(affirm.meterRaf);
    if (affirm.meterSrc) { try { affirm.meterSrc.disconnect(); } catch (e) {} }
    affirm.meterSrc = null;
    $('#recMeter').style.width = '0%';
  }

  /* ---------- review actions ---------- */

  $('#affRecord').addEventListener('click', startRecording);
  $('#affStop').addEventListener('click', stopRecording);

  $('#takePlay').addEventListener('click', () => {
    if (!affirm.pendingTake) return;
    if (!previewEl.paused) { stopPreview(); return; }
    playPreview(affirm.pendingTake.wavBlob, false); // session already held
    $('#takePlay').textContent = '⏹';
  });

  $('#takeAgain').addEventListener('click', () => {
    stopPreview();
    affirm.pendingTake = null;
    startRecording();       // beginCapture keeps the pending session-resume
  });

  $('#takeDiscard').addEventListener('click', () => {
    stopPreview();
    affirm.pendingTake = null;
    studioState('idle');
    engine.resumeAfterCapture();
    recStatus('Discarded. Tap record whenever you are ready.');
  });

  $('#takeSave').addEventListener('click', async () => {
    if (!affirm.pendingTake) return;
    stopPreview();
    const t = affirm.pendingTake;
    affirm.pendingTake = null;
    const rec = {
      id: 'r' + Date.now(),
      name: defaultTakeName(),
      // raw bytes, not a Blob: storing fresh MediaRecorder blobs in iOS
      // IndexedDB throws spurious errors (round-2 device finding)
      data: await t.wavBlob.arrayBuffer(),
      mimeType: 'audio/wav',
      duration: t.duration,
      createdAt: Date.now()
    };
    try {
      await RecDB.put(rec);
      const check = await RecDB.get(rec.id);   // trust the read, not the write
      if (!check) throw new DOMException('write did not persist', 'UnknownError');
    } catch (e) {
      console.warn('recording save failed', e);
      recStatus(`Saved for this session only — device storage failed (${(e && e.name) || 'unknown'}).`);
    }
    affirm.recordings.unshift(rec);
    renderRecordings();
    firstSaveGuardrails();
    studioState('idle');
    // resume FIRST, then load: loadAffirmation's rebuild is skipped while
    // the session is paused, which would leave an old voice playing
    engine.resumeAfterCapture();
    const ok = await engine.loadAffirmation(rec.data);
    if (ok) selectAffirmation('rec:' + rec.id, `“${rec.name}” saved — playing masked under your mix`);
    else recStatus('Saved, but it could not be decoded for playback.');
  });

  function defaultTakeName() {
    const d = new Date();
    return `Take · ${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /* ================= My Recordings ================= */

  const recList = $('#recList');

  async function loadRecordings() {
    try {
      const all = await RecDB.all();
      affirm.recordings = (all || []).sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
      affirm.recordings = [];
    }
    renderRecordings();
    migrateOldTakes();
  }

  /* takes saved before the processing pipeline (raw AAC blobs, possibly
   * one-eared and unnormalized) → process + re-store as mono WAV bytes */
  async function migrateOldTakes() {
    let changed = false;
    for (const rec of affirm.recordings) {
      if (rec.data && rec.mimeType === 'audio/wav') continue;
      try {
        const src = rec.data ? rec.data : await rec.blob.arrayBuffer();
        const p = await engine.processVoiceBlob(src);
        if (!p) continue;
        rec.data = await p.wavBlob.arrayBuffer();
        rec.mimeType = 'audio/wav';
        rec.duration = p.duration;
        delete rec.blob;
        await RecDB.put(rec);
        changed = true;
      } catch (e) { /* keep the original take untouched */ }
    }
    if (changed) renderRecordings();
  }

  function renderRecordings() {
    recList.innerHTML = '';
    $('#recEmpty').hidden = affirm.recordings.length > 0;
    affirm.recordings.forEach(rec => {
      const el = document.createElement('div');
      el.className = 'preset-card aff-card rec-item';
      el.dataset.aff = 'rec:' + rec.id;
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.innerHTML = `
        ${waveGlyph(6)}
        <span class="preset-body">
          <span class="preset-name">${escapeHtml(rec.name)}</span>
          <span class="preset-desc">${fmtDur(rec.duration)} · your voice</span>
        </span>
        <span class="rec-actions">
          <button class="mini-btn" data-act="preview" aria-label="Listen solo">🎧</button>
          <button class="mini-btn" data-act="rename" aria-label="Rename">✎</button>
          <button class="mini-btn" data-act="delete" aria-label="Delete">🗑</button>
        </span>
        <span class="aff-play-ind">▶</span>`;
      el.addEventListener('click', e => {
        const act = e.target.closest('[data-act]');
        if (act) { e.stopPropagation(); handleRecAction(act.dataset.act, rec, act); return; }
        toggleRecSelect(rec);
      });
      recList.appendChild(el);
    });
    refreshCardStates();
  }

  async function toggleRecSelect(rec) {
    const key = 'rec:' + rec.id;
    if (affirm.activeId === key) { deselectAffirmation(); return; }
    updateAffStatus('Loading your voice…');
    const ab = rec.data ? rec.data : await rec.blob.arrayBuffer();
    const ok = await engine.loadAffirmation(ab);
    if (!ok) { updateAffStatus('Could not decode this recording'); return; }
    selectAffirmation(key, `Playing “${rec.name}” — tap again to stop`);
  }

  function handleRecAction(act, rec, btn) {
    if (act === 'preview') {
      if (!previewEl.paused && affirm.previewUrl && previewEl.src === affirm.previewUrl && btn.textContent === '⏹') {
        stopPreview();
        return;
      }
      stopPreview();
      affirm.previewResume = engine.holdSession(); // solo means solo
      playPreview(rec.data ? new Blob([rec.data], { type: rec.mimeType }) : rec.blob, true);
      btn.textContent = '⏹';
      previewEl.onended = () => { btn.textContent = '🎧'; endPreviewHold(); };
    } else if (act === 'rename') {
      const name = prompt('Name this take', rec.name);
      if (name && name.trim()) {
        rec.name = name.trim().slice(0, 60);
        RecDB.put(rec).catch(() => {});
        renderRecordings();
      }
    } else if (act === 'delete') {
      softDelete(rec);
    }
  }

  /* soft delete with undo — no confirm dialogs (Voice Memos pattern) */
  function softDelete(rec) {
    commitPendingDelete();
    if (affirm.activeId === 'rec:' + rec.id) deselectAffirmation();
    affirm.recordings = affirm.recordings.filter(r => r.id !== rec.id);
    renderRecordings();
    const bar = $('#snackbar');
    $('#snackText').textContent = `Deleted “${rec.name}”`;
    bar.classList.add('show');
    affirm.pendingDelete = {
      rec,
      timer: setTimeout(() => commitPendingDelete(), UNDO_MS)
    };
  }

  function commitPendingDelete() {
    const p = affirm.pendingDelete;
    if (!p) return;
    clearTimeout(p.timer);
    affirm.pendingDelete = null;
    $('#snackbar').classList.remove('show');
    RecDB.remove(p.rec.id).catch(() => {});
  }

  $('#snackUndo').addEventListener('click', () => {
    const p = affirm.pendingDelete;
    if (!p) return;
    clearTimeout(p.timer);
    affirm.pendingDelete = null;
    $('#snackbar').classList.remove('show');
    affirm.recordings.unshift(p.rec);
    affirm.recordings.sort((a, b) => b.createdAt - a.createdAt);
    renderRecordings();
  });

  /* persistence guardrails: ask for durable storage; warn Safari-tab users
   * about the 7-day eviction rule (home-screen apps are exempt) */
  function firstSaveGuardrails() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {}
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (!standalone && !localStorage.getItem('syncstate-persist-note')) {
      $('#recPersistNote').hidden = false;
    }
  }
  $('#persistGotIt').addEventListener('click', () => {
    localStorage.setItem('syncstate-persist-note', '1');
    $('#recPersistNote').hidden = true;
  });

  /* ---------- solo preview plumbing ---------- */

  function playPreview(blob, holdHandled) {
    if (!holdHandled) affirm.previewResume = false;
    if (affirm.previewUrl) URL.revokeObjectURL(affirm.previewUrl);
    affirm.previewUrl = URL.createObjectURL(blob);
    previewEl.src = affirm.previewUrl;
    const p = previewEl.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stopPreview() {
    if (!previewEl.paused) previewEl.pause();
    previewEl.onended = null;
    $('#takePlay').textContent = '▶';
    $$('.mini-btn[data-act="preview"]').forEach(b => { b.textContent = '🎧'; });
    endPreviewHold();
  }

  function endPreviewHold() {
    if (affirm.previewResume) {
      affirm.previewResume = false;
      engine.releaseSession(true);
    }
  }
  previewEl.addEventListener('ended', () => { $('#takePlay').textContent = '▶'; });

  /* ================= enable toggle + calibration ================= */

  $('#affToggle').addEventListener('change', e => {
    engine.setAffirmationOn(e.target.checked);
    updateAffStatus(e.target.checked
      ? (engine._affBuffer ? 'Affirmations on — masked under your mix' : 'Pick an affirmation or record your own')
      : 'Affirmations off');
    saveSettings();
  });

  $('#affRatioSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    engine.setParam('affRatio', v);
    $('#affRatioVal').textContent =
      v < 0.06 ? 'Deep subliminal' : v < 0.14 ? 'Subliminal' : v < 0.25 ? 'Liminal edge' : 'Clearly audible';
    saveSettings();
  });

  /* ---------- live meters ---------- */
  function startMeters() {
    if (affirm.meterTimer) return;
    affirm.meterTimer = setInterval(() => {
      const m = engine.getMeters();
      $('#coverMeter').style.width = Math.min(100, m.cover * 100) + '%';
      $('#msgMeter').style.width = Math.min(100, m.message * 100) + '%';
    }, 100);
  }

  function updateAffStatus(msg) { $('#affStatus').textContent = msg; }
  function recStatus(msg) { $('#recStatus').textContent = msg; }

  function fmtDur(sec) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // restore saved ratio + load persisted recordings
  const savedRatio = engine.state.affRatio;
  $('#affRatioSlider').value = savedRatio;
  $('#affRatioSlider').dispatchEvent(new Event('input'));
  studioState('idle');
  loadRecordings();
}

window.AffirmUI = { affirmInit };
