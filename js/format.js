/* ============================================================
 * SyncState formatting helpers — pure, no DOM.
 * Unit-tested in Node alongside render-core / sequencer / programs.
 * ============================================================ */
const SyncFormat = (() => {
  /* seconds → clock. H:MM:SS past an hour (long sleep programs), else M:SS. */
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  return { fmtClock };
})();
if (typeof window !== 'undefined') window.SyncFormat = SyncFormat;
if (typeof module !== 'undefined' && module.exports) module.exports = SyncFormat;
