/**
 * BACKGROUND — Service Worker Tevi CS Bot v0.3.0.0
 * Fully automated: auto-discover endpoints, auto-probe, retry, no manual buttons
 */

const MY_UID = '392388705';
const POLL_INTERVAL_MIN = 3;
const ALARM_NAME = 'tevi-poll';
const LOG = 'http://localhost:3131';
const STATE_KEY = 'tevi_cs_state';
const TOKEN_KEY = 'tevi_cs_token';
const EP_KEY = 'tevi_endpoints';
const SN_KEY = 'tevi_sniff';
const MAX_RETRIES = 2;

// ── LOGGING ──────────────────────────────────────────────────────────────
async function sendLog(msg, level = 'INFO') {
  try {
    await fetch(`${LOG}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'BG', level, message: msg, ts: new Date().toISOString() }),
    }).catch(() => {});
  } catch {}
}
const log = m => sendLog(m, 'INFO');
const logE = m => sendLog(m, 'ERROR');
const logD = m => sendLog(m, 'DEBUG');

// ── HMAC ─────────────────────────────────────────────────────────────────
async function hmac(pathname) {
  const SECRET = 'PRDKqnSNCKrMDF9hAt0PSJ6';
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(pathname + ts);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, data))));
  return `${ts}-${sig}`;
}

// ── TOKEN ────────────────────────────────────────────────────────────────
let token = null;
let uid = null;

function parseToken(t) {
  try {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '=='.slice(0, (4 - p.length % 4) % 4)));
  } catch { return null; }
}

async function loadToken() {
  try {
    const d = await chrome.storage.local.get([TOKEN_KEY, 'tevi_cs_uid']);
    if (d[TOKEN_KEY]) {
      token = d[TOKEN_KEY];
      uid = d.tevi_cs_uid || parseToken(token)?.uid || null;
      log(`[TOKEN] Loaded — UID=${uid}`);
      return token;
    }
  } catch {}
  return null;
}

async function saveToken(t) {
  token = t;
  uid = parseToken(t)?.uid || null;
  try { await chrome.storage.local.set({ [TOKEN_KEY]: t, tevi_cs_uid: uid }); } catch {}
}

async function clearToken() {
  token = null; uid = null;
  try { await chrome.storage.local.remove([TOKEN_KEY, 'tevi_cs_uid']); } catch {}
  log('[TOKEN] Cleared');
}

async function captureToken() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://tevi.com/*' });
    const tab = tabs.find(t => !t.url.includes('/settings')) || tabs[0];
    if (!tab) return null;
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const raw = localStorage.getItem('user_logged_list');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return Object.values(parsed)[0]?.access_token || null;
        } catch { return null; }
      },
    });
    return r?.[0]?.result || null;
  } catch { return null; }
}

async function ensureToken() {
  if (token) return token;
  let t = await loadToken();
  if (t) return t;
  t = await captureToken();
  if (t) { await saveToken(t); return t; }
  return null;
}

// ── STATE ────────────────────────────────────────────────────────────────
const DEF = () => ({ repliedOnce: {}, botEnabled: false, knownUnreadIds: [], lastResult: null });

async function loadState() {
  try {
    const d = await chrome.storage.local.get(STATE_KEY);
    const s = d[STATE_KEY];
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return { ...DEF(), ...s, repliedOnce: { ...DEF().repliedOnce, ...(s.repliedOnce || {}) } };
    }
  } catch {}
  return DEF();
}

async function saveState(s) {
  try { await chrome.storage.local.set({ [STATE_KEY]: s }); } catch {}
}

async function isEnabled() { const s = await loadState(); return !!s.botEnabled; }
async function setEnabled(v) { const s = await loadState(); s.botEnabled = v; await saveState(s); }

// ── AUTO-DISCOVER ENDPOINTS ──────────────────────────────────────────────
async function getDiscoveredEndpoints() {
  try {
    const d = await chrome.storage.local.get([EP_KEY, SN_KEY]);
    const eps = d[EP_KEY] || {};
    const sniffs = d[SN_KEY] || [];
    return { eps, sniffs };
  } catch { return { eps: {}, sniffs: [] }; }
}

async function probeEndpoint(pathname, token, convId, text) {
  const verify = await hmac(pathname);
  const base = `https://wapi.flowstreamx.com${pathname}${pathname.includes('?') ? '&' : '?'}verify=${verify}`;

  const candidates = [
    `${base}&conversation_id=${convId}&text=${encodeURIComponent(text)}&type=TEXT&parser=PLAIN`,
    `${base}conversation_id=${convId}&text=${encodeURIComponent(text)}&type=TEXT&parser=PLAIN`,
    base,
  ];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Origin': 'https://tevi.com',
          'Referer': 'https://tevi.com/messages',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversation_id: convId, text, type: 'TEXT', parser: 'PLAIN' }),
      });
      const body = await resp.text().catch(() => '');
      if (resp.ok) {
        log(`[SEND] ✅ WORKING: ${pathname} → status=${resp.status}`);
        return { ok: true, pathname, status: resp.status };
      }
      logD(`[SEND] ❌ ${pathname} → ${resp.status}: ${body.substring(0, 80)}`);
    } catch (e) {
      logD(`[SEND] ❌ ${pathname} → ${e.message}`);
    }
  }
  return { ok: false };
}

// ── SEND MESSAGE ─────────────────────────────────────────────────────────
const SEND_PATHS = [
  '/messenger/v2/message/',
  '/messenger/v2/rpc/send_message/',
  '/messenger/message/send/',
  '/api/v1/message/send/',
];

let cachedSendPath = null;

async function sendMsg(convId, text) {
  const t = await ensureToken();
  if (!t) return false;

  // Try discovered path first
  if (cachedSendPath) {
    const verify = await hmac(cachedSendPath);
    const url = `https://wapi.flowstreamx.com${cachedSendPath}?verify=${verify}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${t}`,
          'Origin': 'https://tevi.com',
          'Referer': 'https://tevi.com/messages',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversation_id: convId, text, type: 'TEXT', parser: 'PLAIN' }),
      });
      if (resp.ok) { log(`[SEND] ✅ cached path: ${cachedSendPath}`); return true; }
      logD(`[SEND] cached fail ${resp.status}: ${cachedSendPath}`);
    } catch {}
  }

  // Auto-probe all paths
  for (const path of SEND_PATHS) {
    const verify = await hmac(path);
    const url = `https://wapi.flowstreamx.com${path}?verify=${verify}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${t}`,
          'Origin': 'https://tevi.com',
          'Referer': 'https://tevi.com/messages',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversation_id: convId, text, type: 'TEXT', parser: 'PLAIN' }),
      });
      const body = await resp.text().catch(() => '');
      if (resp.ok) {
        log(`[SEND] ✅ FOUND: ${path} → status=${resp.status}`);
        cachedSendPath = path;
        return true;
      }
      logD(`[SEND] ${path} → ${resp.status}: ${body.substring(0, 60)}`);
    } catch (e) {
      logD(`[SEND] ${path} → ${e.message}`);
    }
  }

  // Check sniffer data
  const { sniffs, eps } = await getDiscoveredEndpoints();
  const sendSniffs = sniffs.filter(s => s.type === 'ws_send' || (s.url && s.url.includes('message') && s.method !== 'GET'));
  if (sendSniffs.length > 0) {
    log(`[SNIFFER] Found ${sendSniffs.length} send-related captures — checking...`);
    // Already logged in sniffer, just report
  }

  return false;
}

async function markRead(convId) {
  const t = await ensureToken();
  if (!t) return;
  const pathname = `/messenger/v2/conversation/${convId}/read/`;
  const verify = await hmac(pathname);
  const url = `https://wapi.flowstreamx.com${pathname}?verify=${verify}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${t}`, 'Origin': 'https://tevi.com', 'Accept': 'application/json' },
    });
    logD(`[MARK] read: ${convId.substring(0, 8)}`);
  } catch {}
}

// ── CLASSIFIERS ─────────────────────────────────────────────────────────
const VCS_KW = ['vcs','vc','videocal','video call','videoshow','telfon','telp','telpon','call','private','priv','meet','zoom','ngobrol','chat private','bicara'];
const CAS_KW = ['hai','hi','hello','hey','kak','ka','aduh','permisi','makasih','thanks','ok','oke','sip','wkwk','haha','lol'];

function isVcs(t) { return t && VCS_KW.some(k => t.toLowerCase().includes(k)); }
function isCasual(t) {
  if (!t) return true;
  const l = t.toLowerCase().trim();
  if (l.length < 10) return true;
  const w = l.split(/\s+/).filter(Boolean).length;
  return w <= 5;
}

const TPL_VCS = `vcs available💕
bisa payment ke web https://babyval.com/
➡️ Pilih videocall
Jangan lupa kirim bukti tf ke dm

AKU BALAS CHAT KHUSUS MEMBER ATAU SUDAH PAYMENT VCS`;
const TPL_CAS = `Hai! 💕 Untuk request konten eksklusif atau VCS, bisa via:
1. Join membership: tevi.com/@cutieval
2. Payment VCS: babyval.com → pilih videocall
Terima kasih! 🙏`;

// ── GET CONVERSATIONS ─────────────────────────────────────────────────────
const CONV_PATHS = [
  '/messenger/v2/rpc/get_recent_conversations',
  '/messenger/v2/conversation/get_recent_conversations',
  '/api/v1/conversations/',
];

async function getConvs() {
  const t = await ensureToken();
  if (!t) return { data: null, error: 'no_token' };

  for (const path of CONV_PATHS) {
    const verify = await hmac(path);
    const url = `https://wapi.flowstreamx.com${path}${path.includes('?') ? '&' : '?'}limit=50&filter=UNREAD&verify=${verify}`;
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${t}`,
          'Origin': 'https://tevi.com',
          'Referer': 'https://tevi.com/messages',
          'Accept': 'application/json',
        },
      });
      const text = await resp.text().catch(() => '');
      if (resp.ok) {
        try {
          const json = JSON.parse(text);
          if (json?.success) {
            log(`[API] ✅ Convs: ${path} → ${json.data?.results?.length || 0} unread`);
            return { data: json.data, error: null };
          }
        } catch {}
      }
      logD(`[API] ${path} → ${resp.status}`);
    } catch (e) {
      logD(`[API] ${path} → ${e.message}`);
    }
  }

  // Check token expiry
  const payload = parseToken(t);
  if (payload?.exp && Date.now() > payload.exp * 1000) {
    log('[TOKEN] Expired — clearing for re-capture');
    await clearToken();
    return { data: null, error: 'token_expired' };
  }

  return { data: null, error: 'all_endpoints_failed' };
}

// ── POLL ────────────────────────────────────────────────────────────────
async function poll() {
  const start = Date.now();
  const hour = new Date().getHours();
  const activeHours = hour >= 17 || hour < 5;
  const dry = !activeHours;
  logD(`[POLL] dry=${dry} active=${activeHours}`);

  const state = await loadState();
  const convsResult = await getConvs();

  if (convsResult.error === 'no_token') {
    logE('[POLL] No token');
    await saveState({ ...state, lastResult: { error: 'no_token', time: new Date().toISOString() } });
    return { error: 'no_token' };
  }
  if (convsResult.error === 'token_expired') {
    await saveState({ ...state, lastResult: { error: 'token_expired', time: new Date().toISOString() } });
    return { error: 'token_expired' };
  }
  if (!convsResult.data) {
    await saveState({ ...state, lastResult: { convs: 0, time: new Date().toISOString() } });
    return { convs: 0 };
  }

  const convs = convsResult.data.results || [];
  log(`[POLL] ${convs.length} unread — dry=${dry}`);
  if (dry) { log('[POLL] Dry run only — not sending replies'); }

  const repliedOnce = state.repliedOnce || {};
  const knownIds = state.knownUnreadIds || [];

  let processed = 0, replied = 0, ignored = 0;

  for (const conv of convs) {
    const convId = conv.id;
    if (!convId) { processed++; continue; }

    const rcv = conv.recipient || {};
    const msg = conv.latest_message || {};
    const text = msg.text || '';
    const slug = rcv.channel_slug || '?';
    const sender = msg.sender?.alias || '';
    const isSubscriber = rcv.is_my_subscriber === true;
    const isFirst = !knownIds.includes(convId);

    let action = 'ignore', reason = '';
    if (sender === MY_UID) { action = 'ignore'; reason = 'own'; }
    else if (isSubscriber) { action = 'ignore'; reason = 'member'; }
    else if (isVcs(text) || isFirst) { action = 'vcs'; reason = isVcs(text) ? 'vcs_kw' : 'first'; }
    else if (isCasual(text)) { action = 'casual'; reason = 'casual'; }
    else { action = 'casual'; reason = 'default'; }

    logD(`  [${processed+1}] @${slug}: "${text.substring(0,30)}" → ${action}/${reason}`);

    if (action === 'ignore') { ignored++; processed++; continue; }

    if (repliedOnce[convId]) {
      logD(`    → already replied → mark read`);
      if (!dry) await markRead(convId);
      ignored++; processed++; continue;
    }

    const replyText = action === 'vcs' ? TPL_VCS : TPL_CAS;
    log(`    → REPLY (${action}): "${replyText.substring(0, 30)}..."`);

    if (!dry) {
      const ok = await sendMsg(convId, replyText);
      if (ok) {
        replied++;
        repliedOnce[convId] = new Date().toISOString();
        log(`[POLL] ✅ Replied to @${slug}`);
      } else {
        logE(`[POLL] ❌ Send failed to @${slug} — convId=${convId}`);
      }
    } else {
      replied++;
      repliedOnce[convId] = new Date().toISOString();
    }
    processed++;
  }

  const result = {
    processed, replied, ignored,
    convs: convs.length, dry,
    error: null, time: new Date().toISOString(),
    durationMs: Date.now() - start,
  };

  const newState = {
    ...state,
    repliedOnce,
    knownUnreadIds: convs.map(c => c.id).filter(Boolean),
    lastResult: result,
  };
  await saveState(newState);
  log(`[POLL] Done p=${processed} r=${replied} i=${ignored} (${result.durationMs}ms)`);
  return result;
}

// ── ALARM ────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  if (!(await isEnabled())) { logD('[ALARM] disabled'); return; }
  try { await poll(); } catch (e) { logE(`[ALARM] poll error: ${e.message}`); }
});

// ── MESSAGES ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, send) => {
  if (msg.type === 'GET_STATUS') {
    Promise.all([loadState(), ensureToken()]).then(([state, _]) => {
      send({
        enabled: state.botEnabled,
        result: state.lastResult || {},
        uid,
        hasToken: !!token,
        activeHours: new Date().getHours() >= 17 || new Date().getHours() < 5,
      });
    });
    return true;
  }
  if (msg.type === 'TOGGLE') {
    setEnabled(msg.enabled).then(async () => {
      if (msg.enabled) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MIN, delayInMinutes: 0.5 });
        log('[TOGGLE] ON');
        await poll();
      } else {
        chrome.alarms.cancel(ALARM_NAME);
        log('[TOGGLE] OFF');
      }
      send({ ok: true });
    });
    return true;
  }
  if (msg.type === 'DUMP_SNIFF') {
    getDiscoveredEndpoints().then(({ eps, sniffs }) => {
      log(`[SNIFFER] Dump: ${sniffs.length} entries, ${Object.keys(eps).length} endpoints`);
      Object.entries(eps).forEach(([k, v]) => {
        log(`  ${k} | count=${v.captureCount} | lastStatus=${v.status} | send=${v.isSend}`);
      });
      send({ ok: true, entries: sniffs.length, endpoints: Object.keys(eps).length });
    });
    return true;
  }
});

// ── STARTUP ────────────────────────────────────────────────────────────
(async () => {
  log('[SW] Tevi CS Bot v0.3.0.0 started');
  await loadToken();
  const { eps } = await getDiscoveredEndpoints();
  if (Object.keys(eps).length > 0) {
    log(`[SW] Discovered ${Object.keys(eps).length} endpoints from sniffer`);
  }

  if (await isEnabled()) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MIN, delayInMinutes: 0.5 });
    log('[SW] Was enabled — poll scheduled');
    setTimeout(async () => {
      if (await isEnabled()) await poll();
    }, 1500);
  }
})();
