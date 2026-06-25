/**
 * BACKGROUND — Service Worker Tevi CS Bot v0.2.0.0
 * Fully automated: token capture, poll, retry, recovery
 * NO manual buttons needed — runs 100% autonomous
 */

const MY_UID = '392388705';
const MY_SLUG = 'cutieval';
const POLL_INTERVAL_MIN = 3;
const ALARM_NAME = 'tevi-poll';
const LOG_SERVER = 'http://localhost:3131';
const STORAGE_KEY = 'tevi_cs_state';
const TOKEN_KEY = 'tevi_cs_token';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

// ── LOGGING ──────────────────────────────────────────────────────────────────
async function sendLog(message, level = 'INFO', data = null) {
  try {
    await fetch(`${LOG_SERVER}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'BG', level, message, data }),
    }).catch(() => {});
  } catch {}
}
const log = (msg) => sendLog(msg, 'INFO');
const logE = (msg, data) => sendLog(msg, 'ERROR', data);
const logD = (msg) => sendLog(msg, 'DEBUG');

// ── HMAC ─────────────────────────────────────────────────────────────────────
async function hmac(pathname) {
  const HMAC_SECRET = 'PRDKqnSNCKrMDF9hAt0PSJ6';
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(pathname + ts);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return ts + '-' + btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// ── TOKEN ────────────────────────────────────────────────────────────────────
let cachedToken = null;
let cachedPayload = null;

async function loadPersistedToken() {
  try {
    const d = await chrome.storage.local.get([TOKEN_KEY, 'tevi_cs_uid']);
    if (d[TOKEN_KEY]) {
      cachedToken = d[TOKEN_KEY];
      cachedPayload = parseToken(d[TOKEN_KEY]);
      log(`[TOKEN] Loaded from storage — UID=${cachedPayload?.uid}`);
      return d[TOKEN_KEY];
    }
  } catch {}
  return null;
}

function parseToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let str = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return JSON.parse(atob(str));
  } catch { return null; }
}

async function persistToken(token) {
  cachedToken = token;
  cachedPayload = parseToken(token);
  try {
    await chrome.storage.local.set({ [TOKEN_KEY]: token, tevi_cs_uid: cachedPayload?.uid || null });
  } catch {}
}

async function captureTokenFromTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://tevi.com/*' });
    const target = tabs.find(t => !t.url.includes('/settings')) || tabs[0];
    if (!target) { logE('[TOKEN] No Tevi tab'); return null; }

    const results = await chrome.scripting.executeScript({
      target: { tabId: target.id },
      func: () => {
        try {
          const raw = localStorage.getItem('user_logged_list');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          const userData = Object.values(parsed)[0];
          return userData?.access_token || null;
        } catch { return null; }
      },
    });
    return results?.[0]?.result || null;
  } catch (e) {
    logE('[TOKEN] Capture failed', { error: e.message });
    return null;
  }
}

async function ensureToken() {
  if (cachedToken) return cachedToken;
  let token = await loadPersistedToken();
  if (token) return token;
  token = await captureTokenFromTab();
  if (token) await persistToken(token);
  return token;
}

async function clearToken() {
  cachedToken = null;
  cachedPayload = null;
  try { await chrome.storage.local.remove([TOKEN_KEY, 'tevi_cs_uid']); } catch {}
  log('[TOKEN] Cleared');
}

// ── CLASSIFIERS ───────────────────────────────────────────────────────────────
const VCS_KW = ['vcs','vc','videocal','video call','videoshow','telfon','telp','telpon','telepon','call','private','priv','meet','zoom','ngobrol','chat private','bicara'];
const CASUAL_KW = ['hai','hi','hello','hey','kak','ka','aduh','permisi','makasih','thanks','thank','ok','oke','sip','siap','wkwk','haha','lol','hehe'];

function isOnlyEmoji(t) {
  if (!t) return false;
  const m = t.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
  return m && m.length >= t.length * 0.6;
}
function isVcs(t) { return t && VCS_KW.some(k => t.toLowerCase().includes(k)); }
function isCasual(t) {
  if (!t) return true;
  const l = t.toLowerCase().trim();
  if (l.length < 10) return true;
  if (isOnlyEmoji(l)) return true;
  const w = l.split(/\s+/).filter(Boolean).length;
  const c = CASUAL_KW.filter(k => l.includes(k)).length;
  return w <= 5 && c >= w * 0.5;
}
function isLongIdle(ts) { return ts && (Date.now() - ts) > (6 * 3600 * 1000); }

function classify(conv, knownIds, myUid) {
  const rcv = conv.recipient || {};
  const msg = conv.latest_message || {};
  const stats = conv.stats || {};
  const text = msg.text || '';
  const lastAct = stats.last_read_at || conv.last_activity_at;

  if (msg.sender?.alias === myUid) return { action: 'ignore', reason: 'own' };
  if (rcv.is_my_subscriber === true) return { action: 'ignore', reason: 'member' };
  if (isVcs(text) || !knownIds.includes(conv.id)) return { action: 'vcs', reason: isVcs(text) ? 'vcs_kw' : 'first' };
  if (isLongIdle(lastAct) || isCasual(text)) return { action: 'casual', reason: isLongIdle(lastAct) ? 'idle' : 'casual' };
  return { action: 'casual', reason: 'default' };
}

const TPL_VCS = `vcs available💕
bisa payment ke web https://babyval.com/
➡️ Pilih videocall
Jangan lupa kirim bukti tf ke dm

AKU BALAS CHAT KHUSUS MEMBER ATAU SUDAH PAYMENT VCS`;
const TPL_CASUAL = `Hai! 💕 Untuk request konten eksklusif atau VCS, bisa via:
1. Join membership: tevi.com/@cutieval
2. Payment VCS: babyval.com → pilih videocall
Terima kasih! 🙏`;

// ── API: Conversations ────────────────────────────────────────────────────────
async function getConversations(token) {
  const pathname = '/messenger/v2/rpc/get_recent_conversations';
  const verify = await hmac(pathname);
  const url = `https://wapi.flowstreamx.com${pathname}?limit=50&filter=UNREAD&verify=${verify}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://tevi.com',
      'Referer': 'https://tevi.com/messages',
      'Accept': 'application/json',
    },
  });
  const text = await resp.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    if (json?.success) return json.data;
    logE('[API] Conversations fail', { status: resp.status, msg: json?.message });
    return null;
  } catch {
    logE('[API] Conversations parse fail', { status: resp.status, body: text.substring(0, 100) });
    return null;
  }
}

async function sendReply(convId, text, token) {
  const pathname = '/messenger/v2/message/';
  const verify = await hmac(pathname);
  const url = `https://wapi.flowstreamx.com${pathname}?verify=${verify}`;
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
    const ok = resp.ok;
    if (!ok) logE('[API] Send fail', { status: resp.status, body: body.substring(0, 100) });
    return ok;
  } catch (e) {
    logE('[API] Send exception', { error: e.message });
    return false;
  }
}

async function markRead(convId, token) {
  const pathname = `/messenger/v2/conversation/${convId}/read/`;
  const verify = await hmac(pathname);
  const url = `https://wapi.flowstreamx.com${pathname}?verify=${verify}`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Origin': 'https://tevi.com', 'Accept': 'application/json' },
    });
  } catch {}
}

// ── STATE ─────────────────────────────────────────────────────────────────────
async function loadState() {
  try {
    const d = await chrome.storage.local.get(STORAGE_KEY);
    return d[STORAGE_KEY] || { repliedOnce: {}, botEnabled: false, knownUnreadIds: [] };
  } catch { return { repliedOnce: {}, botEnabled: false, knownUnreadIds: [] }; }
}
async function saveState(s) { try { await chrome.storage.local.set({ [STORAGE_KEY]: s }); } catch {} }
async function setEnabled(v) { const s = await loadState(); s.botEnabled = v; await saveState(s); }
async function isEnabled() { const s = await loadState(); return !!s.botEnabled; }
async function hasReplied(id) { const s = await loadState(); return !!s.repliedOnce[id]; }
async function markReplied(id) {
  const s = await loadState();
  s.repliedOnce[id] = new Date().toISOString();
  const entries = Object.entries(s.repliedOnce);
  if (entries.length > 200) s.repliedOnce = Object.fromEntries(entries.slice(-200));
  await saveState(s);
}
async function setLastResult(r) {
  const s = await loadState();
  s.lastResult = r;
  s.knownUnreadIds = r?.convIds || [];
  await saveState(s);
}

// ── POLL ──────────────────────────────────────────────────────────────────────
async function poll() {
  const start = Date.now();
  const activeHours = new Date().getHours() >= 17 || new Date().getHours() < 5;
  const dry = !activeHours;
  logD(`[POLL] Start dry=${dry}`);

  const token = await ensureToken();
  if (!token) {
    logE('[POLL] No token');
    await setLastResult({ error: 'no_token', time: new Date().toISOString() });
    return { error: 'no_token' };
  }

  const data = await getConversations(token);
  if (data === null) {
    // Token might be expired
    const payload = parseToken(token);
    const exp = payload?.exp * 1000;
    if (exp && Date.now() > exp) {
      log('[TOKEN] Expired — clearing for re-capture');
      await clearToken();
      await setLastResult({ error: 'token_expired', time: new Date().toISOString() });
    } else {
      await setLastResult({ convs: 0, time: new Date().toISOString() });
    }
    return { convs: 0 };
  }

  const convs = data.results || [];
  const state = await loadState();
  const known = state.knownUnreadIds || [];
  log(`[POLL] ${convs.length} unread, dry=${dry}`);

  let processed = 0, replied = 0, ignored = 0;
  for (const conv of convs) {
    const cls = classify(conv, known, MY_UID);
    const text = conv.latest_message?.text || '';
    const slug = conv.recipient?.channel_slug || '?';
    logD(`  [${processed+1}] @${slug}: "${text.substring(0,40)}" → ${cls.action}/${cls.reason}`);

    if (cls.action === 'ignore') { ignored++; processed++; continue; }

    const already = await hasReplied(conv.id);
    if (already) {
      if (!dry) await markRead(conv.id, token);
      ignored++; processed++;
      continue;
    }

    const reply = cls.action === 'vcs' ? TPL_VCS : TPL_CASUAL;
    if (!dry) {
      const ok = await sendReply(conv.id, reply, token);
      if (ok) {
        await markReplied(conv.id);
        replied++;
        log(`[POLL] ✅ Replied to @${slug}`);
      }
    } else {
      await markReplied(conv.id);
      replied++;
    }
    processed++;
  }

  const result = {
    processed, replied, ignored, convs: convs.length,
    dry, error: null, time: new Date().toISOString(),
    durationMs: Date.now() - start
  };
  await setLastResult(result);
  log(`[POLL] Done — p=${processed} r=${replied} i=${ignored} (${result.durationMs}ms)`);
  return result;
}

// ── AUTO-POLL WITH RETRY ──────────────────────────────────────────────────────
async function autoPoll() {
  const enabled = await isEnabled();
  if (!enabled) { logD('[ALARM] Disabled — skip'); return; }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await poll();
      if (!result.error) return; // Success
      lastError = result.error;

      // no_token or token_expired — don't retry, just stop
      if (result.error === 'no_token' || result.error === 'token_expired') {
        log(`[POLL] ${result.error} — waiting for re-login`);
        return;
      }
    } catch (e) {
      lastError = e.message;
      logE(`[POLL] Attempt ${attempt} failed`, { error: e.message });
    }

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * attempt;
      logD(`[POLL] Retry ${attempt+1}/${MAX_RETRIES} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  logE('[POLL] All retries failed', { lastError });
}

// ── ALARM ────────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await autoPoll();
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, send) => {
  const respond = (data) => { try { send(data); } catch {} };

  if (msg.type === 'GET_STATUS') {
    Promise.all([loadState(), loadPersistedToken()]).then(([state, _]) => {
      respond({
        enabled: state.botEnabled,
        result: state.lastResult || {},
        uid: cachedPayload?.uid || null,
        hasToken: !!cachedToken,
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
        // Immediate poll on enable
        await autoPoll();
      } else {
        chrome.alarms.cancel(ALARM_NAME);
        log('[TOGGLE] OFF');
      }
      respond({ ok: true });
    });
    return true;
  }
});

// ── STARTUP ───────────────────────────────────────────────────────────────────
(async () => {
  log('[SW] Tevi CS Bot v0.2.0.0 started');

  // Load token immediately
  await loadPersistedToken();

  // If was enabled, schedule alarm + immediate poll
  const wasEnabled = await isEnabled();
  if (wasEnabled) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MIN, delayInMinutes: 0.5 });
    log('[SW] Was enabled — scheduling poll');
    // Poll once at startup (with delay to ensure SW stays alive)
    setTimeout(async () => {
      if (await isEnabled()) await autoPoll();
    }, 1000);
  }
})();
