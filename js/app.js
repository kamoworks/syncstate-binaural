/* ============================================================
 * SyncState App — UI logic
 * Presets and programs are modeled on US 5,356,368 embodiments:
 *  - Mood Minder state presets
 *  - Sleep Processor 90-minute cycle program with wake-up ramp
 * ============================================================ */

const engine = new BinauralEngine();
let viz = null;

/* ---------- presets (Mood Minder embodiment) ---------- */
const PRESETS = [
  { id: 'deep-sleep', name: 'Deep Sleep', beat: 2,   carrier: 120, noise: 0.22, icon: '🌙',
    desc: 'Delta 2 Hz — deep restorative sleep and healing.' },
  { id: 'meditation', name: 'Meditation', beat: 6,   carrier: 160, noise: 0.18, icon: '🧘',
    desc: 'Theta 6 Hz — deep meditation, imagery, creativity.' },
  { id: 'relaxation', name: 'Relaxation', beat: 10,  carrier: 200, noise: 0.15, icon: '🌿',
    desc: 'Alpha 10 Hz — calm, stress release, relaxed alertness.' },
  { id: 'focus', name: 'Focus', beat: 16, carrier: 240, noise: 0.12, icon: '🎯',
    desc: 'Beta 16 Hz — sustained attention and problem-solving.' },
  { id: 'peak', name: 'Peak Awareness', beat: 40, carrier: 300, noise: 0.08, icon: '⚡',
    desc: 'Gamma 40 Hz — high-level cognition and integration.' },
  { id: 'concentrate', name: 'Concentration', beat: 12, carrier: 220, noise: 0.14, septon: true, icon: '📚',
    desc: 'SMR 12 Hz + Theta septon — study and learning mix.' }
];

/* ---------- Sleep Processor program (patent primary embodiment) ----------
 * Natural ~90-minute cycles: Alpha descent -> Theta -> Delta -> Theta(REM) */
function buildSleepProgram(cycles = 4, wakeUp = true) {
  const stages = [];
  stages.push({ beat: 10, minutes: 5,  label: 'Settling · Alpha', carrier: 180 });
  stages.push({ beat: 6,  minutes: 10, label: 'Descent · Theta', carrier: 150 });
  for (let c = 0; c < cycles; c++) {
    stages.push({ beat: 1.5, minutes: 45, label: `Deep Sleep · Delta (cycle ${c + 1})`, carrier: 110 });
    stages.push({ beat: 5,   minutes: 25, label: `REM · Theta (cycle ${c + 1})`, carrier: 140 });
    if (c < cycles - 1) stages.push({ beat: 3, minutes: 15, label: 'Transition · Delta-Theta', carrier: 120 });
  }
  if (wakeUp) {
    stages.push({ beat: 8,  minutes: 5, label: 'Surfacing · Alpha', carrier: 180 });
    stages.push({ beat: 12, minutes: 5, label: 'Awakening · Low Beta', carrier: 220 });
    stages.push({ beat: 20, minutes: 5, label: 'Awake · Beta', carrier: 260 });
  }
  return stages;
}

/* ---------- state ---------- */
const app = {
  playing: false,
  sessionMin: 20,
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
        septon: s.septon ?? false, monaural: s.monaural ?? 0.35, balance: s.balance ?? 0
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
      engine.startSessionTimer(app.sessionMin);
    }
    viz && viz.start();
  } else {
    engine.stop(3);
    app.playing = false;
    app.program = null;
    updateStageUI(null);
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
    $('#bandChip').textContent = band.name + ' · ' + stage.beat + ' Hz';
    $('#bandChip').style.background = band.color + '33';
    $('#bandChip').style.color = band.color;
    updateBandReadout(stage.beat);
  }
}

/* ---------- engine callbacks ---------- */
engine.onTick = remain => {
  const m = Math.floor(remain / 60), s = remain % 60;
  $('#timerReadout').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
engine.onEnded = () => {
  app.playing = false;
  app.program = null;
  updatePlayUI();
  updateStageUI(null);
  $('#timerReadout').textContent = '00:00';
};
engine.onStage = stage => updateStageUI(stage);

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
const fmtHz = v => (+v).toFixed(v < 10 ? 1 : 0) + ' Hz';
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

  // timer chips
  $$('.time-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.time-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      app.sessionMin = parseInt(chip.dataset.min);
      if (app.playing && !app.program) engine.startSessionTimer(app.sessionMin);
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
  $$('.time-chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.min) === app.sessionMin));
  updateBandReadout(s.beat);
}

function updateBandReadout(beat) {
  const band = bandFor(beat);
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
      <span class="preset-icon">${p.icon}</span>
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
  $('#bandChip').textContent = band.name + ' · ' + p.beat + ' Hz';
  $('#bandChip').style.background = band.color + '33';
  $('#bandChip').style.color = band.color;
  // auto-start for seamless UX
  if (!app.playing) togglePlay();
  else if (!app.program) engine.startSessionTimer(app.sessionMin);
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
    engine.runProgram(stages);
    showTab('session');
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

/* ---------- iOS audio unlock / resume ---------- */
function initIOS() {
  // AudioContext must resume inside a user gesture on iOS — all entry
  // points route through togglePlay / applyPreset which are gesture-driven.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && engine.ctx && engine.ctx.state === 'suspended' && app.playing) {
      engine.ctx.resume();
    }
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
  viz = new Visualizer($('#vizCanvas'), engine);
  viz.start();

  // reflect stored beat on chip
  const band = bandFor(engine.state.beat);
  $('#bandChip').textContent = band.name + ' · ' + engine.state.beat + ' Hz';
  $('#bandChip').style.background = band.color + '33';
  $('#bandChip').style.color = band.color;

  updatePlayUI();
});
