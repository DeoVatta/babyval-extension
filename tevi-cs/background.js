/**
 * BACKGROUND — Service Worker Tevi CS Bot v0.5.0.0
 * AI-powered: Olagon gateway generates replies
 * DOM automation: tab types + sends (visible, human-like)
 * State machine: member / first / return / intro_sent / cs_mode
 *
 * SECRETS: stored in chrome.storage.local keys:
 *   tevi_cs_secrets: { aiKey, hmacSecret }
 *   (set once via popup or background inject)
 */

const MY_UID    = '392388705';
const LOG       = 'http://localhost:3131';
const STATE_KEY = 'tevi_cs_state';
const TOKEN_KEY = 'tevi_cs_token';
const SEC_KEY   = 'tevi_cs_secrets';
const AI_BASE   = 'https://gateway.olagon.site/anthropic/v1';
const POLL_MIN  = 3;
const ALARM     = 'tevi-poll';
const INTRO_WAIT_MS = 3 * 60 * 60 * 1000; // 3 hours

// ── SECRETS (loaded from storage) ───────────────────────────────────────
let _secrets = null;
async function getSecrets() {
  if (_secrets) return _secrets;
  try {
    const d = await chrome.storage.local.get(SEC_KEY);
    _secrets = d[SEC_KEY] || {};
  } catch { _secrets = {}; }
  return _secrets;
}

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
const log  = m => sendLog(m, 'INFO');
const logD = m => sendLog(m, 'DEBUG');
const logE = m => sendLog(m, 'ERROR');

// ── AI REPLY ─────────────────────────────────────────────────────────────
const CS_SYSTEM = `Kamu Sukii, AI Assistant milik Baby Val. Balas pesan dari followers yang chat Baby Val.
Aturan:
- Ramah, helpful, dan friendly
- Jawab sesuai topik yang mereka tanyakan
- Kalau tanya VCS / video call → arahkan ke babyval.com untuk payment
- Kalau tanya membership → arahkan ke tevi.com/@cutieval
- Kalau out of topic → bilang sopan bahwa kamu hanya bisa bantu soal layanan Baby Val
- Jangan kasih info pribadi
- Jawaban pendek, max 2-3 kalimat, pakai emoji 💕
- Bahasa Indonesia casual`;

async function aiReply(messages) {
  const sec = await getSecrets();
  const key = sec.aiKey;
  if (!key) { logE('[AI] No AI key configured'); return null; }

  try {
    const resp = await fetch(`${AI_BASE}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: CS_SYSTEM,
        messages,
        temperature: 0.7,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      logE(`[AI] ❌ ${resp.status}: ${txt.substring(0, 100)}`);
      return null;
    }
    const json = await resp.json();
    const text = json.content?.[0]?.text?.trim();
    log(`[AI] ✅ "${text?.substring(0, 60)}"`);
    return text;
  } catch (e) {
    logE(`[AI] ❌ ${e.message}`);
    return null;
  }
}

// ── TOKEN ────────────────────────────────────────────────────────────────
let token = null, uid = null;

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
      log(`[TOKEN] Loaded UID=${uid}`);
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
const DEF = () => ({
  botEnabled: false,
  convMeta: {},       // convId -> { stage, introAt, senderUid, lastText }
  knownSenders: {},   // uid -> lastSeen ts
  lastResult: null,
  lastAnalysis: null,
});

async function loadState() {
  try {
    const d = await chrome.storage.local.get(STATE_KEY);
    const s = d[STATE_KEY];
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return {
        ...DEF(), ...s,
        convMeta: { ...DEF().convMeta, ...(s.convMeta || {}) },
        knownSenders: { ...DEF().knownSenders, ...(s.knownSenders || {}) },
      };
    }
  } catch {}
  return DEF();
}

async function saveState(s) { try { await chrome.storage.local.set({ [STATE_KEY]: s }); } catch {} }
async function isEnabled()  { const s = await loadState(); return !!s.botEnabled; }
async function setEnabled(v){ const s = await loadState(); s.botEnabled = v; await saveState(s); }

// ── DOM SEND via open tab ───────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function domSend(text, slug) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://tevi.com/*' });
    if (!tabs.length) {
      logE('[DOM] No tevi tab open');
      return false;
    }
    const tab = tabs[0];
    log(`[DOM] Sending via tab ${tab.id} to @${slug}`);
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'DOM_SEND', text, slug });
    if (resp?.ok) {
      log(`[DOM] ✅ Sent to @${slug}`);
      return true;
    }
    logE(`[DOM] Failed: ${resp?.reason || 'unknown'}`);
    return false;
  } catch (e) {
    logE(`[DOM] Error: ${e.message}`);
    return false;
  }
}

// ── HMAC ─────────────────────────────────────────────────────────────────
async function hmac(pathname) {
  const sec = await getSecrets();
  const SECRET = sec.hmacSecret || 'PRDKqnSNCKrMDF9hAt0PSJ6'; // fallback for compat
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(pathname + ts);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, data))));
  return `${ts}-${sig}`;
}

// ── CONVERSATIONS ────────────────────────────────────────────────────────
async function getConvs() {
  const t = await ensureToken();
  if (!t) return { data: null, error: 'no_token' };
  const path = '/messenger/v2/rpc/get_recent_conversations';
  const verify = await hmac(path);
  const url = `https://wapi.flowstreamx.com${path}?limit=50&filter=UNREAD&verify=${verify}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${t}`, 'Origin': 'https://tevi.com', 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      if (json?.success) {
        log(`[API] ✅ ${json.data?.results?.length || 0} unread`);
        return { data: json.data, error: null };
      }
    }
    logD(`[API] ❌ ${resp.status}`);
    return { data: null, error: 'api_failed' };
  } catch (e) {
    logE(`[API] ❌ ${e.message}`);
    return { data: null, error: 'network_error' };
  }
}

// ── ANALYZE ───────────────────────────────────────────────────────────────
async function analyze(convs) {
  const kwCounts = {};
  const KW = ['vcs','payment','join','member','foto','video','order','jual','beli','harga','subscribe','konten','bot','terima kasih'];
  for (const c of convs) {
    const text = c.latest_message?.text || '';
    const lower = text.toLowerCase();
    for (const kw of KW) {
      if (lower.includes(kw)) kwCounts[kw] = (kwCounts[kw] || 0) + 1;
    }
  }
  const sorted = Object.entries(kwCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const analysis = { ts: new Date().toISOString(), topQuestions: sorted.map(([kw, count]) => ({ kw, count })) };
  if (sorted.length > 0) log(`[ANALYSIS] ${sorted.map(s => `${s[0]}(${s[1]})`).join(', ')}`);
  return analysis;
}

// ── POLL ────────────────────────────────────────────────────────────────
async function poll() {
  const start = Date.now();
  const hour  = new Date().getHours();
  const active = hour >= 17 || hour < 5;
  logD(`[POLL] active=${active}`);

  const state = await loadState();
  const convsResult = await getConvs();

  if (convsResult.error === 'no_token') {
    logE('[POLL] No token');
    await saveState({ ...state, lastResult: { error: 'no_token', time: new Date().toISOString() } });
    return;
  }
  if (!convsResult.data) {
    await saveState({ ...state, lastResult: { convs: 0, time: new Date().toISOString() } });
    return;
  }

  const convs = convsResult.data.results || [];
  const analysis = await analyze(convs);

  if (!active) {
    log('[POLL] Outside active hours');
    await saveState({ ...state, lastResult: { convs: convs.length, processed: 0, replied: 0, ignored: convs.length, dry: true, time: new Date().toISOString() } });
    return;
  }

  let processed = 0, replied = 0, ignored = 0;

  for (const conv of convs) {
    const convId    = conv.id;
    if (!convId) { processed++; continue; }

    const rcv       = conv.recipient || {};
    const msg       = conv.latest_message || {};
    const text      = msg.text || '';
    const senderUid  = msg.sender?.uid || '';
    const slug      = rcv.channel_slug || '?';
    const isSub     = rcv.is_my_subscriber === true;
    const meta      = state.convMeta[convId] || {};
    const stage     = meta.stage || 'unknown';

    processed++;

    // ── MEMBER: never touch ─────────────────────────────────────────────
    if (isSub) {
      if (stage !== 'member') { state.convMeta[convId] = { ...meta, stage: 'member' }; }
      logD(`  @${slug} [member] skipped`);
      ignored++;
      continue;
    }

    // ── OWN MESSAGE ────────────────────────────────────────────────────
    if (senderUid === MY_UID) { ignored++; continue; }

    state.knownSenders[senderUid] = Date.now();

    // ── CS_MODE ───────────────────────────────────────────────────────
    if (stage === 'cs_mode') {
      if (text) {
        const aiText = await aiReply([{ role: 'user', content: text }]);
        if (aiText) {
          const ok = await domSend(aiText, slug);
          if (ok) { replied++; log(`  @${slug} [CS] ✅ AI replied`); }
          else { ignored++; logE(`  @${slug} [CS] ❌ DOM failed`); }
        } else { ignored++; }
      } else { ignored++; }
      continue;
    }

    // ── INTRO_SENT ──────────────────────────────────────────────────
    if (stage === 'intro_sent') {
      const elapsed = Date.now() - (meta.introAt || 0);
      if (text && text !== meta.lastText) {
        state.convMeta[convId] = { ...meta, stage: 'cs_mode', lastText: text };
        log(`  @${slug} [intro→CS] replied: "${text.substring(0, 30)}"`);
        const aiText = await aiReply([{ role: 'user', content: text }]);
        if (aiText) {
          const ok = await domSend(aiText, slug);
          if (ok) replied++;
        }
      } else if (elapsed >= INTRO_WAIT_MS) {
        state.convMeta[convId] = { ...meta, stage: 'cs_mode' };
        log(`  @${slug} [intro→CS] timeout`);
        ignored++;
      } else {
        logD(`  @${slug} [intro_sent] waiting (${Math.round(elapsed/60000)}m left)`);
        ignored++;
      }
      continue;
    }

    // ── FIRST / RETURN: send intro ─────────────────────────────────────
    const isReturn = !!state.knownSenders[senderUid] && senderUid !== MY_UID;
    const newStage = isReturn ? 'return' : 'first';

    log(`  @${slug} [${newStage}] "${text.substring(0, 40)}"`);

    const introText = `Perkenalkan dulu 👋\nHalo aku Sukii, AI Assistant milik Baby Val\nKalau mau Chat dengan Baby Val Membership dulu yaa..\n\nKalau mau VCS bisa lakukan pembayaran ke babyval.com`;

    const sent = await domSend(introText, slug);
    if (sent) {
      state.convMeta[convId] = {
        stage: 'intro_sent', introAt: Date.now(),
        senderUid, lastText: text,
      };
      log(`  @${slug} [${newStage}→intro_sent] ✅ intro sent`);
      replied++;
    } else {
      logE(`  @${slug} [${newStage}] ❌ DOM failed`);
      ignored++;
    }
  }

  const result = {
    processed, replied, ignored,
    convs: convs.length, dry: false,
    time: new Date().toISOString(), durationMs: Date.now() - start,
    analysis: analysis.topQuestions.slice(0, 5),
  };

  await saveState({ ...state, lastResult: result, lastAnalysis: analysis });
  log(`[POLL] Done p=${processed} r=${replied} i=${ignored} (${result.durationMs}ms)`);
}

// ── ALARM ────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM) return;
  if (!(await isEnabled())) return;
  try { await poll(); } catch (e) { logE(`[ALARM] ${e.message}`); }
});

// ── MESSAGES ──────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, send) => {
  if (msg.type === 'GET_STATUS') {
    Promise.all([loadState(), ensureToken()]).then(([state]) => {
      send({
        enabled: state.botEnabled, result: state.lastResult || {},
        uid, hasToken: !!token,
        activeHours: new Date().getHours() >= 17 || new Date().getHours() < 5,
        analysis: state.lastAnalysis || null,
        meta: {
          cs:    Object.values(state.convMeta).filter(m => m.stage === 'cs_mode').length,
          intro: Object.values(state.convMeta).filter(m => m.stage === 'intro_sent').length,
          member:Object.values(state.convMeta).filter(m => m.stage === 'member').length,
        },
      });
    });
    return true;
  }

  if (msg.type === 'TOGGLE') {
    setEnabled(msg.enabled).then(async () => {
      if (msg.enabled) {
        chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
        log('[TOGGLE] ON — AI + DOM mode');
        await poll();
      } else {
        chrome.alarms.cancel(ALARM);
        log('[TOGGLE] OFF');
      }
      send({ ok: true });
    });
    return true;
  }

  // Store secrets from popup
  if (msg.type === 'SET_SECRETS') {
    _secrets = msg.secrets;
    await chrome.storage.local.set({ [SEC_KEY]: msg.secrets });
    log('[CONFIG] Secrets updated');
    send({ ok: true });
    return true;
  }
});

// ── BOOT: load secrets ─────────────────────────────────────────────────
(async () => {
  await getSecrets();
  log('[SW] Tevi CS Bot v0.5.0.0 — AI + DOM mode');
  await loadToken();
  if (await isEnabled()) {
    chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
    log('[SW] Was enabled — poll scheduled');
    setTimeout(async () => { if (await isEnabled()) await poll(); }, 2000);
  }
})();
