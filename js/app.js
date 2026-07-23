/* ============================================================
 * SyncState App — UI logic
 * Presets and programs are modeled on US 5,356,368 embodiments:
 *  - Mood Minder state presets
 *  - Sleep Processor 90-minute cycle program with wake-up ramp
 * ============================================================ */

const engine = new BinauralEngine();
let viz = null;

/* Presets (Mood Minder) + Sleep Processor program now live in the pure
 * program library (js/programs.js), unit-tested in Node. */
const { PRESETS, buildSleepProgram } = window.SyncPrograms;
const { fmtClock } = window.SyncFormat;

/* waveform glyph: each preset gets its beat drawn as a wave —
 * slow wide sine for Delta, dense tight sine for Gamma. */
function waveGlyph(beat) {
  const band = bandFor(beat);
  const cycles = 0.8 + Math.log2(Math.max(1, beat)) * 0.55;
  const W = 44, H = 30, mid = H / 2, amp = H * 0.32;
  let pts = '';
  for (let x = 0; x <= W; x += 1) {
    const y = mid + Math.sin((x / W) * Math.PI * 2 * cycles) * amp;
    pts += `${x},${y.toFixed(1)} `;
  }
  return `<svg class="preset-glyph" viewBox="0 0 ${W} ${H}" fill="none">
    <polyline points="${pts}" stroke="${band.color}" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

/* ---------- state ---------- */
const app = {
  playing: false,
  sessionMin: 20,
  sessionTotal: 0,
  activePreset: null,
  program: null,
  programStage: null
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ---------- persistence ---------- */
function saveSettings() {
  localStorage.setItem('syncstate', JSON.stringify({
    ...engine.state, sessionMin: app.sessionMin
  }));
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('syncstate'));
    if (s) {
      Object.assign(engine.state, {
        carrier: s.carrier ?? 200, beat: s.beat ?? 10, volume: s.volume ?? 0.6,
        toneLevel: s.toneLevel ?? 0.8, noiseLevel: s.noiseLevel ?? 0.15,
        septon: s.septon ?? false, monaural: s.monaural ?? 0.35, balance: s.balance ?? 0,
        fmOn: s.fmOn ?? false, fmCarrier: s.fmCarrier ?? 150, fmRate: s.fmRate ?? 6.5,
        fmDepth: s.fmDepth ?? 0.8, fmLevel: s.fmLevel ?? 0.35, fmOneDivF: s.fmOneDivF ?? false,
        affOn: s.affOn ?? false, affRatio: s.affRatio ?? 0.12
      });
      app.sessionMin = s.sessionMin ?? 20;
    }
  } catch (e) {}
}

/* ---------- transport ---------- */
async function togglePlay() {
  if (!app.playing) {
    await engine.start();
    app.playing = true;
    if (app.program) {
      // program already scheduled on start
    } else {
      app.sessionTotal = app.sessionMin * 60;
      engine.startSessionTimer(app.sessionMin);
    }
    viz && viz.start();
  } else {
    engine.stop(3);
    app.playing = false;
    app.program = null;
    updateStageUI(null);
    updateSleepView();
  }
  updatePlayUI();
}

function updatePlayUI() {
  const btn = $('#playBtn');
  btn.classList.toggle('playing', app.playing);
  btn.innerHTML = app.playing
    ? '<svg viewBox="0 0 24 24" width="34" height="34"><rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
  $('#nowPlaying').textContent = app.playing
    ? (app.programStage ? app.programStage.label : (app.activePreset ? app.activePreset.name : 'Custom Session'))
    : 'Ready';
  document.body.classList.toggle('is-playing', app.playing);
}

function updateStageUI(stage) {
  app.programStage = stage;
  if (stage) {
    $('#nowPlaying').textContent = stage.label;
    const band = bandFor(stage.beat);
    $('#bandChip').textContent = band.name + ' · ' + stage.beat + '\u2009Hz';
    $('#bandChip').style.background = band.color + '33';
    $('#bandChip').style.color = band.color;
    updateBandReadout(stage.beat);
  }
}

/* ---------- sleep tab running state ---------- */
function updateSleepView() {
  const running = !!app.program;
  $('#sleepConfig').hidden = running;
  $('#sleepRunning').hidden = !running;
}

function refreshSleepRunning(stage, remain) {
  if (!app.program) return;
  const st = stage || app.programStage;
  if (st) {
    const band = bandFor(st.beat);
    $('#srStage').textContent = st.label;
    $('#srStage').style.color = band.color;
    if (st.index != null) $('#srMeta').textContent = `Stage ${st.index + 1} of ${app.program.length}`;
  }
  if (remain != null && app.sessionTotal) {
    $('#srRemaining').textContent = fmtClock(remain);
    const pct = Math.max(0, Math.min(100, (1 - remain / app.sessionTotal) * 100));
    $('#srFill').style.width = pct + '%';
  }
}

/* ---------- engine callbacks ---------- */
const DIAL_C = 2 * Math.PI * 78; // dial ring circumference
engine.onTick = remain => {
  const m = Math.floor(remain / 60), s = remain % 60;
  $('#timerReadout').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const prog = app.sessionTotal ? 1 - remain / app.sessionTotal : 0;
  $('#dialProg').style.strokeDashoffset = DIAL_C * (1 - prog);
  refreshSleepRunning(null, remain);
};
engine.onEnded = () => {
  app.playing = false;
  app.program = null;
  updatePlayUI();
  updateStageUI(null);
  $('#timerReadout').textContent = '00:00';
  updateSleepView();
};
engine.onStage = stage => { updateStageUI(stage); refreshSleepRunning(stage, null); };
engine.onStatus = msg => {
  if (msg) $('#nowPlaying').textContent = msg;
  else updatePlayUI();
};
// lock-screen controls / interruptions change playback outside the UI
engine.onPlayState = playing => {
  if (app.playing === playing) return;
  app.playing = playing;
  updatePlayUI();
};

/* ---------- controls binding ---------- */
function bindSlider(id, key, fmt, transform = (v => v), inverse = (v => v)) {
  const el = $(id);
  el.addEventListener('input', () => {
    const v = transform(parseFloat(el.value));
    engine.setParam(key, v);
    $(id + 'Val').textContent = fmt(v);
    if (key === 'beat') updateBandReadout(v);
    saveSettings();
  });
}
const fmtHz = v => (+v).toFixed(v < 10 ? 1 : 0) + '\u2009Hz';
const fmtPct = v => Math.round(v * 100) + '%';

function initControls() {
  bindSlider('#carrierSlider', 'carrier', fmtHz);
  bindSlider('#beatSlider', 'beat', fmtHz, v => Math.pow(10, v), v => Math.log10(v)); // log slider
  bindSlider('#volumeSlider', 'volume', fmtPct);
  bindSlider('#toneSlider', 'toneLevel', fmtPct);
  bindSlider('#noiseSlider', 'noiseLevel', fmtPct);
  bindSlider('#balanceSlider', 'balance', v => (v > 0 ? 'R +' : v < 0 ? 'L +' : '') + Math.abs(Math.round(v * 100)) + '%');

  $('#septonToggle').addEventListener('change', e => {
    engine.setParam('septon', e.target.checked);
    saveSettings();
  });

  /* ---- Masaki Focus Tone controls ---- */
  $('#fmToggle').addEventListener('change', e => {
    engine.setParam('fmOn', e.target.checked);
    if (e.target.checked && !app.playing) togglePlay();
    saveSettings();
  });
  $('#fmRateSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    engine.setFmRate(v);
    $('#fmRateVal').textContent = v.toFixed(1) + '\u2009Hz';
    saveSettings();
  });
  $('#fmDepthSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    engine.setParam('fmDepth', v);
    $('#fmDepthVal').textContent = Math.round(v * 100) + '%';
    saveSettings();
  });
  $('#fmCarrierSlider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    engine.setParam('fmCarrier', v);
    $('#fmCarrierVal').textContent = v + '\u2009Hz';
    saveSettings();
  });
  $('#onefToggle').addEventListener('change', e => {
    engine.setOneDivF(e.target.checked);
    saveSettings();
  });

  // timer chips
  $$('.time-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.time-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      app.sessionMin = parseInt(chip.dataset.min);
      if (app.playing && !app.program) {
        app.sessionTotal = app.sessionMin * 60;
        engine.startSessionTimer(app.sessionMin);
      }
      saveSettings();
    });
  });
}

function refreshControlValues() {
  const s = engine.state;
  $('#carrierSlider').value = s.carrier;
  $('#carrierSliderVal').textContent = fmtHz(s.carrier);
  $('#beatSlider').value = Math.log10(s.beat);
  $('#beatSliderVal').textContent = fmtHz(s.beat);
  $('#volumeSlider').value = s.volume;
  $('#volumeSliderVal').textContent = fmtPct(s.volume);
  $('#toneSlider').value = s.toneLevel;
  $('#toneSliderVal').textContent = fmtPct(s.toneLevel);
  $('#noiseSlider').value = s.noiseLevel;
  $('#noiseSliderVal').textContent = fmtPct(s.noiseLevel);
  $('#balanceSlider').value = s.balance;
  $('#balanceSliderVal').textContent = '0%';
  $('#septonToggle').checked = s.septon;
  // Masaki channel
  $('#fmToggle').checked = s.fmOn;
  $('#fmRateSlider').value = s.fmRate;
  $('#fmRateVal').textContent = (+s.fmRate).toFixed(1) + '\u2009Hz';
  $('#fmDepthSlider').value = s.fmDepth;
  $('#fmDepthVal').textContent = Math.round(s.fmDepth * 100) + '%';
  $('#fmCarrierSlider').value = s.fmCarrier;
  $('#fmCarrierVal').textContent = s.fmCarrier + '\u2009Hz';
  $('#onefToggle').checked = s.fmOneDivF;
  if (s.fmOneDivF) engine.setOneDivF(true);
  $$('.time-chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.min) === app.sessionMin));
  updateBandReadout(s.beat);
}

function updateBandReadout(beat) {
  const band = bandFor(beat);
  // dynamic state tinting — Session & Visualize follow the band color
  document.documentElement.style.setProperty('--state', band.color);
  $('#bandName').textContent = band.name;
  $('#bandName').style.color = band.color;
  $('#bandLabel').textContent = band.label;
  $$('.band-dot').forEach(d => {
    const active = d.dataset.band === band.name;
    d.classList.toggle('active', active);
    if (active) d.style.setProperty('--dot-color', band.color);
  });
}

/* ---------- presets UI ---------- */
function renderPresets() {
  const wrap = $('#presetList');
  wrap.innerHTML = '';
  PRESETS.forEach(p => {
    const el = document.createElement('button');
    el.className = 'preset-card';
    el.innerHTML = `
      ${waveGlyph(p.beat)}
      <span class="preset-body">
        <span class="preset-name">${p.name}</span>
        <span class="preset-desc">${p.desc}</span>
      </span>
      <span class="preset-freq">${p.beat} Hz</span>`;
    el.addEventListener('click', () => applyPreset(p, el));
    wrap.appendChild(el);
  });
}

function applyPreset(p, el) {
  $$('.preset-card').forEach(c => c.classList.remove('active'));
  el && el.classList.add('active');
  app.activePreset = p;
  app.program = null;
  engine.setParam('beat', p.beat);
  engine.setParam('carrier', p.carrier);
  engine.setParam('noiseLevel', p.noise);
  engine.setParam('septon', !!p.septon);
  refreshControlValues();
  $('#nowPlaying').textContent = p.name;
  const band = bandFor(p.beat);
  $('#bandChip').textContent = band.name + ' · ' + p.beat + '\u2009Hz';
  $('#bandChip').style.background = band.color + '33';
  $('#bandChip').style.color = band.color;
  // auto-start for seamless UX
  if (!app.playing) togglePlay();
  else if (!app.program) {
    app.sessionTotal = app.sessionMin * 60;
    engine.startSessionTimer(app.sessionMin);
  }
}

/* ---------- sleep program UI ---------- */
function initSleepUI() {
  $('#startSleep').addEventListener('click', async () => {
    const cycles = parseInt($('#cycleSelect').value);
    const wakeUp = $('#wakeToggle').checked;
    const stages = buildSleepProgram(cycles, wakeUp);
    app.program = stages;
    app.activePreset = null;
    if (!app.playing) {
      await engine.start();
      app.playing = true;
      viz && viz.start();
      updatePlayUI();
    }
    app.sessionTotal = stages.reduce((a, s) => a + s.minutes * 60, 0);
    engine.runProgram(stages);
    updateSleepView();
    refreshSleepRunning({ ...stages[0], index: 0 }, app.sessionTotal);
  });

  $('#stopSleep').addEventListener('click', () => {
    engine.stop(3);
    app.playing = false;
    app.program = null;
    updatePlayUI();
    updateStageUI(null);
    updateSleepView();
  });

  // duration preview
  const update = () => {
    const cycles = parseInt($('#cycleSelect').value);
    const wakeUp = $('#wakeToggle').checked;
    const total = buildSleepProgram(cycles, wakeUp).reduce((a, s) => a + s.minutes, 0);
    $('#sleepDuration').textContent = `Total: ${Math.floor(total / 60)}h ${total % 60}m · ${cycles} cycle${cycles > 1 ? 's' : ''}${wakeUp ? ' · wake-up sequence' : ''}`;
  };
  $('#cycleSelect').addEventListener('change', update);
  $('#wakeToggle').addEventListener('change', update);
  update();
}

/* ---------- tabs ---------- */
function showTab(name) {
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'visual') viz && viz._resize();
}
function initTabs() {
  $$('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
}

/* ---------- iOS recovery ---------- */
function initIOS() {
  // Playback runs through a media element and survives lock/background;
  // on return, resume if iOS paused us and resync the wall-clock schedule.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && app.playing) engine.recoverPlayback();
  });
}

/* ---------- boot ---------- */
window.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initTabs();
  initControls();
  renderPresets();
  initSleepUI();
  initIOS();
  refreshControlValues();
  $('#playBtn').addEventListener('click', togglePlay);
  window.SyncHelp && SyncHelp.initHelp();
  window.AffirmUI && AffirmUI.affirmInit(engine, $, $$);
  viz = new Visualizer($('#vizCanvas'), engine);
  viz.start();

  // reflect stored beat on chip
  const band = bandFor(engine.state.beat);
  $('#bandChip').textContent = band.name + ' · ' + engine.state.beat + '\u2009Hz';
  $('#bandChip').style.background = band.color + '33';
  $('#bandChip').style.color = band.color;

  // dial ring init
  const dial = $('#dialProg');
  dial.style.strokeDasharray = DIAL_C;
  dial.style.strokeDashoffset = DIAL_C;

  updatePlayUI();
  updateSleepView();
});
