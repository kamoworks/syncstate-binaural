/* ============================================================
 * SyncState Affirmations — Mikell US 5,245,666 implementation
 *  - User voice recording (patent primary mode)
 *  - Curated affirmation library (shown in full — no hidden text)
 *  - Liminal calibration + live masking meters
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

const affirm = {
  recorder: null,
  chunks: [],
  recording: false,
  activeId: null,
  meterTimer: null
};

function affirmInit(engine, $, $$) {

  /* ---------- library ---------- */
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
        // tapping the active card stops and deselects it completely
        engine.clearAffirmation();
        affirm.activeId = null;
        $('#affToggle').checked = false;
        refreshCardStates();
        updateAffStatus('Stopped — tap any affirmation to start again');
        return;
      }
      updateAffStatus('Loading…');
      const ab = await fetchB64(a.file).catch(() => null);
      const ok = ab ? await engine.loadAffirmation(ab) : false;
      if (!ok) return;
      affirm.activeId = a.id;
      refreshCardStates();
      if (!engine.state.affOn) {
        engine.setAffirmationOn(true);
        $('#affToggle').checked = true;
      }
      updateAffStatus(`Playing “${a.name}” — tap the card again to stop`);
      if (!app.playing) togglePlay(); // need the cover mix running
      startMeters();
    });
    list.appendChild(el);
  });

  /* ---------- recording ---------- */
  const recBtn = $('#affRecord');
  recBtn.addEventListener('click', async () => {
    if (affirm.recording) return stopRecording();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      affirm.chunks = [];
      affirm.recorder = new MediaRecorder(stream);
      affirm.recorder.ondataavailable = e => affirm.chunks.push(e.data);
      affirm.recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(affirm.chunks, { type: affirm.recorder.mimeType });
        const ab = await blob.arrayBuffer();
        const ok = await engine.loadAffirmation(ab);
        if (ok) {
          affirm.activeId = 'custom';
          refreshCardStates();
          $('#affToggle').checked = true;
          engine.setAffirmationOn(true);
          updateAffStatus('Your voice is loaded — masked under your mix');
          if (!app.playing) togglePlay();
          startMeters();
        } else {
          updateAffStatus('Could not decode recording — try again');
        }
      };
      affirm.recorder.start();
      affirm.recording = true;
      recBtn.classList.add('recording');
      recBtn.innerHTML = '⏹';
      updateAffStatus('Recording… speak your affirmation, tap again to finish');
    } catch (e) {
      updateAffStatus('Microphone access is needed to record');
    }
  });

  function stopRecording() {
    affirm.recording = false;
    recBtn.classList.remove('recording');
    recBtn.innerHTML = '●';
    affirm.recorder && affirm.recorder.stop();
    updateAffStatus('Processing…');
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

  /* ---------- enable toggle + calibration ---------- */
  $('#affToggle').addEventListener('change', e => {
    engine.setAffirmationOn(e.target.checked);
    updateAffStatus(e.target.checked
      ? (engine._affBuffer ? 'Affirmations on — masked under your mix' : 'Pick a library affirmation or record your own')
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

  function updateAffStatus(msg) {
    $('#affStatus').textContent = msg;
  }

  // restore saved ratio
  const savedRatio = engine.state.affRatio;
  $('#affRatioSlider').value = savedRatio;
  $('#affRatioSlider').dispatchEvent(new Event('input'));
}

window.AffirmUI = { affirmInit };
