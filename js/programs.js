/* ============================================================
 * SyncState Program Library — pure Sequence definitions.
 * Declarative preset/stage data for the Sequencer (see
 * docs/SPEC-SEQUENCER-CORE-2026-07-23.md). No DOM / WebAudio —
 * pure data + functions, unit-tested in Node beside render-core.
 * Modeled on US 5,356,368 embodiments (Mood Minder, Sleep Processor).
 * ============================================================ */
const SyncPrograms = (() => {
  const PRESETS = [
    { id: 'deep-sleep', name: 'Deep Sleep', beat: 2,   carrier: 120, noise: 0.22,
      desc: 'Delta 2 Hz — deep restorative sleep and healing.' },
    { id: 'meditation', name: 'Meditation', beat: 6,   carrier: 160, noise: 0.18,
      desc: 'Theta 6 Hz — deep meditation, imagery, creativity.' },
    { id: 'relaxation', name: 'Relaxation', beat: 10,  carrier: 200, noise: 0.15,
      desc: 'Alpha 10 Hz — calm, stress release, relaxed alertness.' },
    { id: 'focus', name: 'Focus', beat: 16, carrier: 240, noise: 0.12,
      desc: 'Beta 16 Hz — sustained attention and problem-solving.' },
    { id: 'peak', name: 'Peak Awareness', beat: 40, carrier: 300, noise: 0.08,
      desc: 'Gamma 40 Hz — high-level cognition and integration.' },
    { id: 'concentrate', name: 'Concentration', beat: 12, carrier: 220, noise: 0.14, septon: true,
      desc: 'SMR 12 Hz + Theta septon — study and learning mix.' }
  ];

  /* Natural ~90-min cycles: Alpha descent -> Theta -> Delta -> Theta(REM) */
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

  return { PRESETS, buildSleepProgram };
})();
if (typeof window !== 'undefined') window.SyncPrograms = SyncPrograms;
if (typeof module !== 'undefined' && module.exports) module.exports = SyncPrograms;
