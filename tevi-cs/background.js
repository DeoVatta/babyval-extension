/**
 * BACKGROUND — Service Worker Tevi CS Bot (MV3)
 * Port dari babyval-autopilot/tevi-cs/bot.js + api.js
 * LOGGING: Semua log di-POST ke localhost:3131 (log-server.js)
 */

const MY_UID = '392388705';
const MY_SLUG = 'cutieval';
const POLL_INTERVAL_MIN = 3;
const ALARM_NAME = 'tevi-poll';
const LOG_SERVER = 'http://localhost:3131';
const LOG_SOURCE = 'BG';
const LOG_LEVEL = 'INFO';
const LOG_LEVEL_ERROR = 'ERROR';
const LOG_LEVEL_DEBUG = 'DEBUG';

// ── LOGGING ──────────────────────────────────────────────────────────────────
// Kirim log ke log-server.js → file tevi-cs-logs.txt
// Saya (Claude) baca file ini untuk debug & fix
async function sendLog(message, level = 'INFO', data = null) {
  const entry = { source: LOG_SOURCE, level, message, data };
  try {
    await fetch(`${LOG_SERVER}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    // Silently fail — don't break bot if log server is down
  }
}

// Aliases untuk convenience
function log(msg) { sendLog(msg, 'INFO'); }
function logError(msg, data) { sendLog(msg, 'ERROR', data); }
function logDebug(msg) { sendLog(msg, 'DEBUG'); }

// ── Active hours: aktif jam 17:00 - 05:00 ──────────────────────────────────
function isActiveHours() {
  const hour = new Date().getHours();
  return hour >= 17 || hour < 5;
}

// ── HMAC via Web Crypto API ─────────────────────────────────────────────────
async function hmac(pathname) {
  const HMAC_SECRET = 'PRDKqnSNCKrMDF9hAt0PSJ6';
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(pathname + ts);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return ts + '-' + sigBase64;
}

function parseTokenPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload));
  } catch { return null; }
}

// ── Token management ───────────────────────────────────────────────────────
let cachedToken = null;
let cachedTokenPayload = null;

async function persistToken(token) {
  cachedToken = token;
  cachedTokenPayload = parseTokenPayload(token);
  try {
    await chrome.storage.local.set({ tevi_cs_token: token, tevi_cs_uid: cachedTokenPayload?.uid || null });
  } catch {}
}

async function loadPersistedToken() {
  try {
    const data = await chrome.storage.local.get(['tevi_cs_token', 'tevi_cs_uid']);
    if (data?.tevi_cs_token) {
      cachedToken = data.tevi_cs_token;
      cachedTokenPayload = parseTokenPayload(data.tevi_cs_token);
      return data.tevi_cs_token;
    }
  } catch {}
  return null;
}

async function injectAndGetToken(tabId) {
  if (!tabId) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          const raw = localStorage.getItem('user_logged_list');
          if (!raw) return { success: false, error: 'no raw data' };
          const parsed = JSON.parse(raw);
          const userData = Object.values(parsed)[0];
          const token = userData?.access_token;
          if (token) return { success: true, token };
          return { success: false, error: 'no access_token in userData', userDataKeys: Object.keys(userData || {}) };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
    });
    if (results && results[0]) return results[0].result;
    return null;
  } catch (e) {
    logError('[TOKEN] Inject failed', { error: e.message });
    return null;
  }
}

async function requestToken() {
  if (cachedToken) return cachedToken;

  // Try persisted token first
  const persisted = await loadPersistedToken();
  if (persisted) return persisted;

  try {
    const tabs = await chrome.tabs.query({ url: '*://tevi.com/*' });
    const teviTab = tabs.find(t => !t.url.includes('/settings'));
    const targetTab = teviTab || tabs[0];

    if (!targetTab) {
      logError('[TOKEN] No Tevi tab open', { tabsFound: tabs.length });
      return null;
    }

    log(`[TOKEN] Injecting into tab: ${targetTab.url}`);
    const result = await injectAndGetToken(targetTab.id);

    if (result?.success) {
      await persistToken(result.token);
      log(`[TOKEN] OK — UID=${cachedTokenPayload?.uid} | prefix=${result.token.substring(0, 20)}`);
      return result.token;
    }

    logError('[TOKEN] Inject returned empty', { result });
    return null;
  } catch (e) {
    logError('[TOKEN] requestToken failed', { error: e.message });
    return null;
  }
}

// ── Classifiers (inline) ────────────────────────────────────────────────────
const VCS_KEYWORDS = ['vcs','vc','videocal','video call','videoshow','telfon','telp','telpon','telepon','call','private','priv','meet','zoom','skype','ngobrol','chat private','bicara'];
const CASUAL_KEYWORDS = ['hai','hi','hello','hey','kak','ka','aduh','permisi','makasih','thanks','thank','ok','oke','sip','siap','wkwk','haha','lol','hehe'];

function isOnlyEmoji(text) {
  if (!text || text.length === 0) return false;
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  const matches = text.match(emojiPattern);
  return matches && matches.length >= text.length * 0.6;
}
function isVcsAsk(msgText) { return msgText && VCS_KEYWORDS.some(kw => msgText.toLowerCase().includes(kw)); }
function isCasual(msgText) {
  if (!msgText) return true;
  const lower = msgText.toLowerCase().trim();
  if (lower.length < 10) return true;
  if (isOnlyEmoji(lower)) return true;
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const casualCount = CASUAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  return wordCount <= 5 && casualCount >= wordCount * 0.5;
}
function isLongIdle(lastActivityAt) { return lastActivityAt && (Date.now() - lastActivityAt) > (6 * 60 * 60 * 1000); }

function classify(conv, knownUnreadIds, myUid) {
  const recipient = conv.recipient || {};
  const latestMsg = conv.latest_message || {};
  const stats = conv.stats || {};
  const msgText = latestMsg.text || '';
  const lastActivityAt = stats.last_read_at || conv.last_activity_at;

  if (latestMsg.sender?.alias === myUid) return { action: 'ignore', reason: 'own_message' };
  if (recipient?.is_my_subscriber === true) return { action: 'ignore', reason: 'member' };
  const isFirst = !knownUnreadIds.includes(conv.id);
  if (isVcsAsk(msgText) || isFirst) return { action: 'vcs', reason: isVcsAsk(msgText) ? 'vcs_ask' : 'first_chat' };
  if (isLongIdle(lastActivityAt) || isCasual(msgText)) return { action: 'casual', reason: isLongIdle(lastActivityAt) ? 'long_idle' : 'casual_chat' };
  return { action: 'casual', reason: 'default' };
}

// ── Reply templates ──────────────────────────────────────────────────────────
const TEMPLATES = {
  VCS: `vcs available💕\nbisa payment ke web https://babyval.com/\n➡️ Pilih videocall\nJangan lupa kirim bukti tf ke dm\n\nAKU BALAS CHAT KHUSUS MEMBER ATAU SUDAH PAYMENT VCS`,
  CASUAL: `Hai! 💕 Untuk request konten eksklusif atau VCS, bisa via:\n1. Join membership: tevi.com/@cutieval\n2. Payment VCS: babyval.com → pilih videocall\nTerima kasih! 🙏`,
};

// ── API: Conversations ──────────────────────────────────────────────────────
const DISCOVERED_ENDPOINT_KEY = 'tevi_cs_api_state';

async function getDiscoveredEndpoint() {
  try {
    const data = await chrome.storage.local.get(DISCOVERED_ENDPOINT_KEY);
    return data[DISCOVERED_ENDPOINT_KEY]?.discoveredEndpoint || null;
  } catch { return null; }
}

async function getUnreadConversations(token) {
  // Auto-discovered endpoint first, fallback to known working path
  const discovered = await getDiscoveredEndpoint();
  const basePath = discovered || '/messenger/v2/rpc/get_recent_conversations';
  const verify = await hmac(basePath);
  const url = `https://wapi.flowstreamx.com${basePath}${basePath.includes('?') ? '&' : '?'}limit=20&filter=UNREAD&verify=${verify}`;

  logDebug(`[CONVS] GET ${url}`);
  logDebug(`[CONVS] Token: ${token?.substring(0, 15)}...`);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://tevi.com',
        'Referer': 'https://tevi.com/messages',
        'Accept': 'application/json',
      },
    });
    logDebug(`[CONVS] Response status: ${resp.status}`);
    const text = await resp.text().catch(() => '');
    logDebug(`[CONVS] Response body (first 200): ${text.substring(0, 200)}`);

    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (data?.success) {
      log(`[CONVS] OK — ${data.data?.results?.length || 0} conversations`);
      return data.data;
    }
    logError('[CONVS] API returned error', { status: resp.status, data: text.substring(0, 300) });
    return null;
  } catch (e) {
    logError('[CONVS] Fetch failed', { error: e.message });
    return null;
  }
}

// ── API: Send Message ────────────────────────────────────────────────────────
async function sendMessage(convId, text, token) {
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
    log(`[SEND] conv=${convId.substring(0, 8)} status=${resp.status}`);
    if (!resp.ok) logError('[SEND] Failed', { status: resp.status, body: body.substring(0, 200) });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    logError('[SEND] Exception', { error: e.message });
    return { ok: false, status: 0 };
  }
}

// ── API: Mark Read ──────────────────────────────────────────────────────────
async function markRead(convId, token) {
  const pathname = `/messenger/v2/conversation/${convId}/read/`;
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
    });
    return { ok: resp.ok };
  } catch { return { ok: false }; }
}

// ── State ───────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'tevi_cs_state';
async function loadState() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data[STORAGE_KEY] || { repliedOnce: {}, botEnabled: false, lastPoll: null, knownUnreadIds: [] };
  } catch { return { repliedOnce: {}, botEnabled: false, lastPoll: null, knownUnreadIds: [] }; }
}
async function saveState(state) {
  try { await chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch {}
}
async function markReplied(convId) {
  const state = await loadState();
  state.repliedOnce[convId] = new Date().toISOString();
  const entries = Object.entries(state.repliedOnce);
  if (entries.length > 200) state.repliedOnce = Object.fromEntries(entries.slice(-200));
  await saveState(state);
}
async function hasReplied(convId) { const s = await loadState(); return !!s.repliedOnce[convId]; }
async function setBotEnabled(enabled) { const s = await loadState(); s.botEnabled = enabled; await saveState(s); }
async function isBotEnabled() { const s = await loadState(); return !!s.botEnabled; }
async function setLastPoll(result) { const s = await loadState(); s.lastPoll = new Date().toISOString(); s.lastPollResult = result; s.knownUnreadIds = result?.convIds || []; await saveState(s); }
async function getLastPoll() { const s = await loadState(); return { lastPoll: s.lastPoll, result: s.lastPollResult }; }

// ── Main Poll ───────────────────────────────────────────────────────────────
async function poll(dry = false) {
  const startTime = Date.now();
  log(`[POLL] Start — dry=${dry} activeHours=${isActiveHours()}`);

  const token = await requestToken();
  if (!token) {
    logError('[POLL] FAILED — no token', { cachedToken: !!cachedToken });
    await setLastPoll({ error: 'no_token', time: new Date().toISOString() });
    return { processed: 0, replied: 0, ignored: 0, error: 'no_token' };
  }

  const convData = await getUnreadConversations(token);
  if (!convData || !Array.isArray(convData.results)) {
    log('[POLL] No conversations data');
    await setLastPoll({ convs: 0, time: new Date().toISOString() });
    return { processed: 0, replied: 0, ignored: 0 };
  }

  const convs = convData.results;
  const botState = await loadState();
  const knownUnreadIds = botState.knownUnreadIds || [];
  log(`[POLL] Unread=${convs.length} known=${knownUnreadIds.length}`);

  if (convs.length === 0) {
    await setLastPoll({ convs: 0, time: new Date().toISOString() });
    return { processed: 0, replied: 0, ignored: 0 };
  }

  let processed = 0, replied = 0, ignored = 0;

  for (const conv of convs) {
    const convId = conv.id;
    const recipient = conv.recipient || {};
    const latestMsg = conv.latest_message || {};
    const msgText = latestMsg.text || '';
    const recipientSlug = recipient.channel_slug || 'unknown';

    const cls = classify(conv, knownUnreadIds, MY_UID);
    log(`  [${processed + 1}] @${recipientSlug} | "${msgText.substring(0, 50)}" | ${cls.action}/${cls.reason}`);

    if (cls.action === 'ignore') { ignored++; processed++; continue; }

    const repliedBefore = await hasReplied(convId);
    if (repliedBefore) {
      log(`    → Replied before → mark read`);
      if (!dry) await markRead(convId, token);
      ignored++; processed++; continue;
    }

    const replyText = cls.action === 'vcs' ? TEMPLATES.VCS : TEMPLATES.CASUAL;
    log(`    → REPLY (${cls.action})`);

    if (!dry) {
      const result = await sendMessage(convId, replyText, token);
      if (result?.ok) {
        log(`    → Sent ✅`);
        await markReplied(convId);
        replied++;
      } else {
        logError(`    → Failed: ${result?.status}`, { convId });
      }
    } else {
      log(`    → [DRY]`);
      await markReplied(convId);
      replied++;
    }
    processed++;
  }

  const summary = { processed, replied, ignored, convs: convs.length, dry, time: new Date().toISOString(), durationMs: Date.now() - startTime };
  await setLastPoll(summary);
  log(`[POLL] Done — processed=${processed} replied=${replied} ignored=${ignored} (${Date.now() - startTime}ms)`);
  return summary;
}

// ── Alarm Handler ───────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const enabled = await isBotEnabled();
  if (!enabled) { logDebug('[ALARM] Bot disabled — skip'); return; }
  const dry = !isActiveHours();
  if (dry) logDebug('[ALARM] Closed hours — dry');
  await poll(dry);
});

// ── Message Handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    // Reload persisted token if SW restarted
    if (!cachedToken) await loadPersistedToken();
    Promise.all([getLastPoll(), isBotEnabled()]).then(([last, enabled]) => {
      sendResponse({ enabled, lastPoll: last.lastPoll, result: last.result, activeHours: isActiveHours(), hasToken: !!cachedToken, uid: cachedTokenPayload?.uid || null });
    });
    return true;
  }
  if (msg.type === 'TOGGLE_BOT') {
    setBotEnabled(msg.enabled).then(async () => {
      if (msg.enabled) {
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MIN, delayInMinutes: 0.5 });
        log('[TOGGLE] ENABLED — alarm scheduled');
      } else {
        chrome.alarms.cancel(ALARM_NAME);
        log('[TOGGLE] DISABLED — alarm cancelled');
      }
      sendResponse({ ok: true, enabled: msg.enabled });
    });
    return true;
  }
  if (msg.type === 'MANUAL_POLL') {
    poll(false).then(r => sendResponse(r));
    return true;
  }
  if (msg.type === 'CLEAR_TOKEN') {
    cachedToken = null; cachedTokenPayload = null;
    try { await chrome.storage.local.remove(['tevi_cs_token', 'tevi_cs_uid']); } catch {}
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'FORCE_TOKEN') {
    cachedToken = null; cachedTokenPayload = null;
    requestToken().then(token => sendResponse({ ok: !!token, token: token?.substring(0, 20) }));
    return true;
  }
});

// ── Startup ─────────────────────────────────────────────────────────────────
log('[SW] Tevi CS Bot v0.1.0.3 started — logging to localhost:3131');

isBotEnabled().then(async (enabled) => {
  if (enabled) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MIN, delayInMinutes: 0.5 });
    log('[SW] Bot was enabled — alarm rescheduled');
  }
});
