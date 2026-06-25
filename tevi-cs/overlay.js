/**
 * FLOATING OVERLAY — Tevi CS Bot v0.2.0.0
 * Fully automated: no buttons needed
 * Shows: toggle, stats, status, last poll, errors
 */

(function() {
  'use strict';

  if (window.__TEVI_CS_OVERLAY__) return;
  window.__TEVI_CS_OVERLAY__ = true;

  const VER = '0.2.0.0';
  const LOG = 'http://localhost:3131';

  // ── Styles ─────────────────────────────────────────────────────────────────
  inject(`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    .tcw * { box-sizing: border-box; margin: 0; padding: 0; }

    .tcw {
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      font-family: 'Inter', sans-serif; font-size: 13px; color: #e0e0e0;
    }

    /* FAB */
    .tcw-fab {
      width: 52px; height: 52px; border-radius: 16px; border: none; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); padding: 0;
    }
    .tcw-fab.on {
      background: linear-gradient(135deg, #00cc6a 0%, #009955 100%);
      box-shadow: 0 4px 20px rgba(0,204,106,0.35), 0 2px 8px rgba(0,0,0,0.3);
    }
    .tcw-fab.on:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(0,204,106,0.5); }
    .tcw-fab.off {
      background: linear-gradient(135deg, #333 0%, #222 100%);
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    }
    .tcw-fab.off:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
    .tcw-fab:active { transform: scale(0.95); }
    .tcw-fab .t-ic { font-size: 22px; line-height: 1; }
    .tcw-fab .t-lb { font-size: 7px; font-weight: 700; color: rgba(255,255,255,0.8); letter-spacing: 0.3px; }
    .tcw-fab .t-do {
      position: absolute; top: 8px; right: 8px; width: 8px; height: 8px;
      border-radius: 50%; border: 2px solid #0a0a0f;
    }
    .tcw-fab .t-do.grn { background: #00ff88; box-shadow: 0 0 6px #00ff88; }
    .tcw-fab .t-do.red { background: #ff4757; box-shadow: 0 0 6px #ff4757; }
    .tcw-fab .t-do.orn { background: #ffa502; box-shadow: 0 0 6px #ffa502; }
    .tcw-fab .t-do.gry { background: #555; }

    /* Panel */
    .tcw-pn {
      position: absolute; bottom: 64px; right: 0; width: 260px;
      background: #0f0f1a; border: 1px solid #1e1e30; border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5); overflow: hidden;
      transform-origin: bottom right;
      animation: tcp-in 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
      display: none;
    }
    .tcw-pn.o { display: block; }
    @keyframes tcp-in {
      from { opacity: 0; transform: scale(0.88) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* Header */
    .tcw-hd {
      background: linear-gradient(135deg, #00cc6a 0%, #008844 100%);
      padding: 10px 14px; display: flex; align-items: center; gap: 8px;
      border-radius: 16px 16px 0 0;
    }
    .tcw-hd .ic { font-size: 20px; }
    .tcw-hd .ti { flex: 1; }
    .tcw-hd .ti .tt { font-size: 13px; font-weight: 700; color: #fff; }
    .tcw-hd .ti .tv { font-size: 9px; color: rgba(255,255,255,0.5); }
    .tcw-hd .bd {
      font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 20px;
      background: rgba(255,255,255,0.2); color: #fff;
    }

    /* Body */
    .tcw-bd { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }

    /* Status */
    .tcw-sr {
      display: flex; align-items: center; gap: 10px;
      background: #1a1a2e; border-radius: 10px; padding: 8px 12px;
    }
    .tcw-sr .do { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .tcw-sr .do.G { background: #00ff88; box-shadow: 0 0 8px #00ff88; }
    .tcw-sr .do.R { background: #ff4757; box-shadow: 0 0 8px #ff4757; }
    .tcw-sr .do.N { background: #555; }
    .tcw-sr .do.O { background: #ffa502; box-shadow: 0 0 8px #ffa502; }
    .tcw-sr .lb { font-weight: 600; font-size: 13px; color: #fff; }
    .tcw-sr .sb { font-size: 10px; color: #888; margin-top: 1px; }

    /* Toggle */
    .tcw-tr {
      display: flex; align-items: center; justify-content: space-between;
      background: #1a1a2e; border-radius: 10px; padding: 8px 12px;
    }
    .tcw-tr .tl { font-size: 12px; color: #ccc; }
    .tcw-tg { position: relative; width: 38px; height: 22px; }
    .tcw-tg input { opacity: 0; width: 0; height: 0; }
    .tcw-sl {
      position: absolute; cursor: pointer; inset: 0;
      background: #333; border-radius: 22px; transition: 0.3s;
    }
    .tcw-sl::before {
      content: ''; position: absolute; width: 16px; height: 16px;
      left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.3s;
    }
    .tcw-tg input:checked + .tcw-sl { background: #00cc6a; }
    .tcw-tg input:checked + .tcw-sl::before { transform: translateX(16px); }

    /* Stats */
    .tcw-st { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }
    .tcw-st .sk {
      background: #1a1a2e; border-radius: 8px; padding: 6px 4px; text-align: center;
    }
    .tcw-st .sn { font-size: 18px; font-weight: 700; color: #fff; }
    .tcw-st .sl { font-size: 8px; color: #555; margin-top: 1px; text-transform: uppercase; }

    /* Info */
    .tcw-if { background: #1a1a2e; border-radius: 10px; padding: 7px 12px; }
    .tcw-if .ir { display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; }
    .tcw-if .ir:last-child { margin-bottom: 0; }
    .tcw-if .ir span:first-child { color: #555; }
    .tcw-if .ir span:last-child { color: #aaa; font-family: monospace; }

    /* Error banner */
    .tcw-er {
      background: #2a1a1a; border: 1px solid #ff475744; border-radius: 8px;
      padding: 6px 10px; font-size: 10px; color: #ff6b6b; display: none;
    }
    .tcw-er.sh { display: block; }
  `);

  function inject(css) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Build UI ────────────────────────────────────────────────────────────────
  const ui = document.createElement('div');
  ui.className = 'tcw';
  ui.innerHTML = `
    <div class="tcw-pn" id="tPn">
      <div class="tcw-hd">
        <div class="ic">🤖</div>
        <div class="ti"><div class="tt">Tevi CS Bot</div><div class="tv">v${VER}</div></div>
        <div class="bd" id="tBd">OFF</div>
      </div>
      <div class="tcw-bd">
        <div class="tcw-sr">
          <div class="do N" id="tDo"></div>
          <div><div class="lb" id="tLb">Memuat...</div><div class="sb" id="tSb">—</div></div>
        </div>
        <div class="tcw-er" id="tEr"></div>
        <div class="tcw-tr">
          <span class="tcw-tr tl">Aktifkan Bot</span>
          <label class="tcw-tg">
            <input type="checkbox" id="tTg">
            <span class="tcw-sl"></span>
          </label>
        </div>
        <div class="tcw-st">
          <div class="sk"><div class="sn" id="tP">—</div><div class="sl">Proc</div></div>
          <div class="sk"><div class="sn" id="tR">—</div><div class="sl">Replied</div></div>
          <div class="sk"><div class="sn" id="tI">—</div><div class="sl">Ignored</div></div>
        </div>
        <div class="tcw-if">
          <div class="ir"><span>Last Poll</span><span id="tLP">—</span></div>
          <div class="ir"><span>Token UID</span><span id="tUID">—</span></div>
          <div class="ir"><span>Hours</span><span id="tHr">—</span></div>
        </div>
      </div>
    </div>
    <button class="tcw-fab off" id="tFab" title="Tevi CS Bot v${VER}">
      <div class="t-do gry" id="tFabDo"></div>
      <div class="t-ic">🤖</div>
      <div class="t-lb">TEVI</div>
    </button>
  `;
  document.body.appendChild(ui);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const pn    = document.getElementById('tPn');
  const fab   = document.getElementById('tFab');
  const fabDo = document.getElementById('tFabDo');
  const bd    = document.getElementById('tBd');
  const tDo   = document.getElementById('tDo');
  const tLb   = document.getElementById('tLb');
  const tSb   = document.getElementById('tSb');
  const tEr   = document.getElementById('tEr');
  const tTg   = document.getElementById('tTg');
  const tP    = document.getElementById('tP');
  const tR    = document.getElementById('tR');
  const tI    = document.getElementById('tI');
  const tLP   = document.getElementById('tLP');
  const tUID  = document.getElementById('tUID');
  const tHr   = document.getElementById('tHr');

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function fmt(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  function setStatus(enabled, hasToken, result, activeHours) {
    if (!enabled) {
      pn.classList.remove('o');
      fab.className = 'tcw-fab off';
      fabDo.className = 't-do gry';
      bd.textContent = 'OFF';
      tDo.className = 'do N';
      tLb.textContent = 'Nonaktif';
      tSb.textContent = 'Toggle untuk aktifkan';
      tEr.classList.remove('sh');
      tEr.textContent = '';
    } else if (!hasToken) {
      fab.className = 'tcw-fab off';
      fabDo.className = 't-do red';
      bd.textContent = 'ERR';
      tDo.className = 'do R';
      tLb.textContent = 'No Token';
      tSb.textContent = 'Buka Tevi & login';
      tEr.classList.add('sh');
      tEr.textContent = '⚠️ Login ke tevi.com, lalu buka ulang popup ini';
    } else if (result?.error) {
      fab.className = 'tcw-fab on';
      fabDo.className = 't-do orn';
      bd.textContent = 'ERR';
      tDo.className = 'do O';
      tLb.textContent = 'Error';
      tSb.textContent = result.error;
      tEr.classList.add('sh');
      tEr.textContent = '⚠️ ' + result.error;
    } else {
      fab.className = 'tcw-fab on';
      fabDo.className = 't-do grn';
      bd.textContent = 'ON';
      tDo.className = 'do G';
      tLb.textContent = 'Aktif';
      tSb.textContent = activeHours ? '🟢 Memantau' : '🟡 Closed (dry)';
      tEr.classList.remove('sh');
    }

    // Stats
    tP.textContent = result?.processed ?? '—';
    tR.textContent = result?.replied ?? '—';
    tI.textContent = result?.ignored ?? '—';
    tLP.textContent = fmt(result?.time);

    // Hours
    tHr.innerHTML = activeHours
      ? '<span style="color:#00cc6a;font-weight:600">BUKA</span>'
      : '<span style="color:#ff4757;font-weight:600">TUTUP</span>';
  }

  // ── Load & refresh ─────────────────────────────────────────────────────────
  async function refresh() {
    let state = { enabled: false, result: {}, uid: null, hasToken: false, activeHours: true };

    // Fast: toggle state from localStorage (sync)
    try {
      const ls = JSON.parse(localStorage.getItem('tevi_cs_popup') || '{}');
      state.enabled = ls.botEnabled ?? false;
    } catch {}

    // Then get full state from SW
    try {
      const s = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (s) {
        state = { ...state, ...s };
        // Update localStorage if different
        localStorage.setItem('tevi_cs_popup', JSON.stringify({ botEnabled: state.enabled }));
      }
    } catch {}

    tUID.textContent = state.uid || '—';
    tTg.checked = state.enabled;
    setStatus(state.enabled, state.hasToken, state.result, state.activeHours);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  fab.addEventListener('click', () => {
    pn.classList.toggle('o');
    if (pn.classList.contains('o')) refresh();
  });

  tTg.addEventListener('change', async () => {
    const enabled = tTg.checked;
    localStorage.setItem('tevi_cs_popup', JSON.stringify({ botEnabled: enabled }));

    // Optimistic UI
    if (enabled) {
      tDo.className = 'do O'; tLb.textContent = 'Aktif'; tSb.textContent = '⏳ Menyimpan...';
      fab.className = 'tcw-fab on'; fabDo.className = 't-do grn'; bd.textContent = 'ON';
    } else {
      tDo.className = 'do N'; tLb.textContent = 'Nonaktif'; tSb.textContent = '⏳ Menyimpan...';
      fab.className = 'tcw-fab off'; fabDo.className = 't-do gry'; bd.textContent = 'OFF';
    }

    try {
      await chrome.runtime.sendMessage({ type: 'TOGGLE', enabled });
      const isAH = new Date().getHours() >= 17 || new Date().getHours() < 5;
      setStatus(enabled, true, {}, isAH);
    } catch {
      tSb.textContent = enabled ? '⚠️ Alarm pending' : 'Nonaktif';
    }
  });

  // Auto-refresh panel every 15s
  setInterval(() => { if (pn.classList.contains('o')) refresh(); }, 15000);

  // ── Init ───────────────────────────────────────────────────────────────────
  refresh();
})();
