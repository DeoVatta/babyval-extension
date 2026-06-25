/**
 * POPUP — Tevi CS Bot UI v0.1.0.2
 * Floating card layout, localStorage toggle persist, remote logging
 */
const VER = '0.1.0.2';

const $ = id => document.getElementById(id);
const LOG_SERVER = 'http://localhost:3131';
const LS_KEY = 'tevi_cs_popup';

const el = {
  topBadge:     $('topBadge'),
  sdot:         $('sdot'),
  slabel:       $('slabel'),
  ssub:         $('ssub'),
  noTokenBanner:$('noTokenBanner'),
  logDot:       $('logDot'),
  logStatus:    $('logStatus'),
  botToggle:    $('botToggle'),
  sp:           $('sp'),
  sr:           $('sr'),
  si:           $('si'),
  ilp:          $('ilp'),
  iah:          $('iah'),
  iuid:         $('iuid'),
  itok:         $('itok'),
  itab:         $('itab'),
  logPanel:     $('logPanel'),
  btnPoll:      $('btnPoll'),
  btnProbe:     $('btnProbe'),
  btnDiagnose:  $('btnDiagnose'),
  btnViewLogs:  $('btnViewLogs'),
  btnClearToken:$('btnClearToken'),
  btnRefresh:   $('btnRefresh'),
};

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('id-ID', { day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' }); }
  catch { return '—'; }
}
function fmtMs(ms) { return (!ms && ms!==0) ? '—' : ms<1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`; }

// ── localStorage — SYNC instant persist ──────────────────────────────────────
function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function lsSet(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} }

// ── Init toggle IMMEDIATELY (sync) before any async ────────────────────────────
(function() {
  const state = lsGet();
  el.botToggle.checked = state.botEnabled ?? false;
  // Update top badge too
  updateTopBadge(state.botEnabled ?? false, false, false);
})();

function updateTopBadge(enabled, hasToken, hasError) {
  if (!enabled) {
    el.topBadge.textContent = 'OFF';
    el.topBadge.style.background = 'rgba(255,255,255,0.2)';
  } else if (hasError || !hasToken) {
    el.topBadge.textContent = 'ERR';
    el.topBadge.style.background = 'rgba(255,71,87,0.4)';
  } else {
    el.topBadge.textContent = 'ON';
    el.topBadge.style.background = 'rgba(0,0,0,0.2)';
  }
}

// ── Load status ──────────────────────────────────────────────────────────────
async function loadStatus() {
  const persisted = lsGet();
  const storageEnabled = persisted.botEnabled ?? false;
  el.botToggle.checked = storageEnabled;

  let swData = null;
  try { swData = await chrome.runtime.sendMessage({ type: 'GET_STATUS' }); } catch {}
  const hasToken = swData?.hasToken ?? false;
  const activeHours = swData?.activeHours ?? true;
  const result = swData?.result ?? persisted.lastResult ?? {};

  if (!storageEnabled) {
    el.sdot.className = 'sdot gray';
    el.slabel.textContent = 'Nonaktif';
    el.ssub.textContent = 'Toggle untuk mengaktifkan';
    el.noTokenBanner.classList.remove('show');
  } else if (!hasToken || result.error === 'no_token') {
    el.sdot.className = 'sdot red';
    el.slabel.textContent = 'No Token';
    el.ssub.textContent = 'Buka tab Tevi & refresh';
    el.noTokenBanner.classList.add('show');
  } else {
    el.sdot.className = 'sdot green';
    el.slabel.textContent = 'Aktif';
    el.ssub.textContent = activeHours ? '🟢 Memantau' : '🟡 Closed (dry)';
    el.noTokenBanner.classList.remove('show');
  }

  el.sp.textContent = result.processed ?? '—';
  el.sr.textContent = result.replied ?? '—';
  el.si.textContent = result.ignored ?? '—';
  if (result.durationMs) el.sp.textContent = `${result.processed ?? 0} (${fmtMs(result.durationMs)})`;

  el.ilp.textContent = fmtTime(swData?.lastPoll || persisted.lastResult?.time);
  el.iuid.textContent = swData?.uid || '—';
  el.itok.textContent = hasToken ? `✅ ${(swData?.token||'').substring(0,8)}...` : '❌';
  el.iah.innerHTML = activeHours
    ? '<span class="badge open">BUKA</span>'
    : '<span class="badge closed">TUTUP</span>';

  updateTopBadge(storageEnabled, hasToken, !!result.error);
}

// ── Toggle ───────────────────────────────────────────────────────────────────
el.botToggle.addEventListener('change', async () => {
  const enabled = el.botToggle.checked;

  // UI sync
  if (enabled) { el.sdot.className='sdot green'; el.slabel.textContent='Aktif'; el.ssub.textContent='⏳ Menyimpan...'; }
  else { el.sdot.className='sdot gray'; el.slabel.textContent='Nonaktif'; el.ssub.textContent='⏳ Menyimpan...'; }

  // localStorage SYNC
  lsSet({ ...lsGet(), botEnabled: enabled });
  updateTopBadge(enabled, null, false);

  // chrome.storage
  try {
    const ex = await chrome.storage.local.get('tevi_cs_state');
    const bg = ex?.tevi_cs_state || {};
    await chrome.storage.local.set({ tevi_cs_state: { ...bg, botEnabled: enabled } });
  } catch {}

  // Tell background
  try {
    await chrome.runtime.sendMessage({ type: 'TOGGLE_BOT', enabled });
    el.ssub.textContent = enabled ? 'Sedang memantau' : 'Toggle untuk mengaktifkan';
    updateTopBadge(enabled, null, false);
  } catch {
    el.ssub.textContent = enabled ? 'Aktif (alarm pending)' : 'Nonaktif';
  }
});

// ── Check log server ────────────────────────────────────────────────────────
async function checkLogServer() {
  try {
    const r = await fetch(`${LOG_SERVER}/health`, { method: 'GET' });
    if (r.ok) {
      const d = await r.json();
      el.logDot.className = 'ldot ok';
      el.logStatus.textContent = `Log server ✅ (${d.stats.lines} lines)`;
    }
  } catch {
    el.logDot.className = 'ldot bad';
    el.logStatus.textContent = 'Log server ❌ — run log-server.js';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function showLog(txt) { el.logPanel.textContent = txt; el.logPanel.classList.add('show'); }
function hideLog() { el.logPanel.classList.remove('show'); }

// ── Poll ────────────────────────────────────────────────────────────────────
async function doPoll() {
  el.btnPoll.textContent = '⏳...'; el.btnPoll.disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'MANUAL_POLL' });
    el.sp.textContent = r.processed ?? '0';
    el.sr.textContent = r.replied ?? '0';
    el.si.textContent = r.ignored ?? '0';
    el.ilp.textContent = fmtTime(new Date().toISOString());
    if (r.durationMs) el.sp.textContent = `${r.processed??0} (${fmtMs(r.durationMs)})`;
    const ls = lsGet();
    lsSet({ ...ls, lastResult: r });
    if (r.error==='no_token') {
      el.noTokenBanner.classList.add('show');
      el.sdot.className='sdot red'; el.slabel.textContent='No Token';
      el.btnPoll.textContent = '❌ No Token';
    } else {
      el.btnPoll.textContent = `✅ ${r.replied} replied`;
    }
  } catch { el.btnPoll.textContent = '❌ Error'; }
  setTimeout(() => { el.btnPoll.textContent='🔄 Poll'; el.btnPoll.disabled=false; }, 3000);
}

// ── Probe API ─────────────────────────────────────────────────────────────────
async function doProbe() {
  el.btnProbe.textContent='⏳...'; el.btnProbe.disabled=true;
  showLog('Probing endpoints...\n');
  let report = `=== API PROBE v${VER} ===\n\n`;
  let token = null;
  try {
    const tabs = await chrome.tabs.query({url:'*://tevi.com/*'});
    if (tabs.length>0) {
      const diag = await chrome.tabs.sendMessage(tabs[0].id,{type:'DIAGNOSE'});
      if (diag?.success) token = diag.token;
    }
  } catch {}
  if (!token) { showLog('❌ No token — open Tevi tab first'); el.btnProbe.textContent='🔎 Probe'; el.btnProbe.disabled=false; return; }
  report += `✅ Token: ${token.substring(0,25)}...\n\n`;
  const tests = [
    '/messenger/v2/conversation/get_recent_conversations/?filter=UNREAD&limit=5',
    '/messenger/v2/conversations/?filter=UNREAD',
    '/messenger/v1/conversations/',
    '/api/v2/conversations/',
  ];
  for (const ep of tests) {
    try {
      const r = await fetch(`https://wapi.flowstreamx.com${ep}`, {
        method:'GET',
        headers:{'Authorization':`Bearer ${token}`,'Origin':'https://tevi.com','Referer':'https://tevi.com/messages','Accept':'application/json'},
      });
      const body = await r.text().catch(()=>'');
      if (r.ok) report += `✅ ${r.status} ${ep}\n   ${body.substring(0,80)}...\n\n`;
      else report += `❌ ${r.status} ${ep}\n   ${body.substring(0,80)}\n\n`;
    } catch(e) { report += `❌ NET ${ep}\n   ${e.message}\n\n`; }
  }
  showLog(report);
  el.btnProbe.textContent='🔎 Probe'; el.btnProbe.disabled=false;
}

// ── Diagnose ──────────────────────────────────────────────────────────────────
async function doDiagnose() {
  el.btnDiagnose.textContent='⏳...'; el.btnDiagnose.disabled=true;
  showLog('Running diagnostic...\n');
  let r = `=== DIAGNOSE v${VER} ===\n\n`;
  r += `[1] Toggle (localStorage)\n   botEnabled: ${lsGet().botEnabled}\n`;
  r += '\n[2] Log Server\n';
  try {
    const d = await fetch(`${LOG_SERVER}/health`).then(x=>x.json()).catch(()=>null);
    if (d) r += `   ✅ ${d.stats.lines} lines\n`;
    else r += '   ❌ Not running\n';
  } catch { r += '   ❌ Cannot reach\n'; }
  r += '\n[3] chrome.storage\n';
  try {
    const s = await chrome.storage.local.get('tevi_cs_state');
    r += `   botEnabled: ${s?.tevi_cs_state?.botEnabled}\n`;
    r += `   lastPoll: ${s?.tevi_cs_state?.lastPoll||'never'}\n`;
  } catch(e) { r += `   Error: ${e.message}\n`; }
  r += '\n[4] Tevi Tab\n';
  try {
    const tabs = await chrome.tabs.query({url:'*://tevi.com/*'});
    r += `   Found: ${tabs.length} tab(s)\n`;
    el.itab.textContent = tabs.length>0 ? `${tabs.length} tab(s)` : '❌ none';
    if (tabs.length>0) {
      r += '\n[5] Token\n';
      try {
        const d = await chrome.tabs.sendMessage(tabs[0].id,{type:'DIAGNOSE'});
        if (d?.success) {
          r += `   ✅ UID: ${d.payloadUid}\n   length: ${d.tokenLength} chars\n   prefix: ${d.tokenPrefix}\n`;
          el.iuid.textContent = d.payloadUid || '—';
          el.itok.textContent = `✅ ${(d.token||'').substring(0,8)}...`;
        } else {
          r += `   ❌ ${d?.error||'unknown'}\n`;
          if (d?.userDataKeys) r += `   userData keys: ${d.userDataKeys}\n`;
        }
      } catch(e) { r += `   ❌ Content script error: ${e.message}\n`; }
    }
  } catch(e) { r += `   Error: ${e.message}\n`; }
  r += '\n[6] Recent Logs\n';
  try {
    const logs = await fetch(`${LOG_SERVER}/logs?count=8`).then(x=>x.json()).catch(()=>null);
    if (logs?.logs) {
      for (const l of logs.logs.split('\n').filter(Boolean).slice(-8)) r += `  ${l}\n`;
    } else r += '  No logs\n';
  } catch { r += '  Cannot fetch\n'; }
  showLog(r);
  el.btnDiagnose.textContent='🔍 Diagnose'; el.btnDiagnose.disabled=false;
}

// ── View Logs ────────────────────────────────────────────────────────────────
async function doViewLogs() {
  el.btnViewLogs.textContent='⏳...'; el.btnViewLogs.disabled=true;
  try {
    const d = await fetch(`${LOG_SERVER}/logs?count=80`).then(x=>x.json());
    if (d?.logs) {
      const lines = d.logs.split('\n').filter(Boolean).slice(-50).join('\n');
      showLog(`=== LAST 50 of ${d.stats.lines} LOGS ===\n\n${lines}`);
    }
  } catch { showLog('Cannot connect to log server.'); }
  el.btnViewLogs.textContent='📋 Logs'; el.btnViewLogs.disabled=false;
}

// ── Clear Token ──────────────────────────────────────────────────────────────
async function doClearToken() {
  el.btnClearToken.textContent='⏳...'; el.btnClearToken.disabled=true;
  try {
    await chrome.runtime.sendMessage({type:'CLEAR_TOKEN'});
    el.itok.textContent='❌ cleared';
    el.sdot.className='sdot orange'; el.slabel.textContent='Token Cleared';
    el.btnClearToken.textContent='✅ Cleared!';
  } catch { el.btnClearToken.textContent='❌ Error'; }
  setTimeout(()=>{ el.btnClearToken.textContent='🗑 Clear'; el.btnClearToken.disabled=false; }, 2000);
}

// ── Event bindings ──────────────────────────────────────────────────────────
el.btnPoll.addEventListener('click', doPoll);
el.btnProbe.addEventListener('click', doProbe);
el.btnDiagnose.addEventListener('click', doDiagnose);
el.btnViewLogs.addEventListener('click', doViewLogs);
el.btnClearToken.addEventListener('click', doClearToken);
el.btnRefresh.addEventListener('click', () => { hideLog(); loadStatus(); });

// ── Init ────────────────────────────────────────────────────────────────────
checkLogServer();
loadStatus();
