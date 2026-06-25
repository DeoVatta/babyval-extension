/**
 * BACKGROUND — Service Worker Tevi CS Bot v0.5.1.0
 * Config-driven: all behavior from tevi_cs_config
 * Flow: intro → CS turns → done (read-only)
 * DOM typing for visible send
 */

const MY_UID    = '392388705';
const LOG       = 'http://localhost:3131';
const STATE_KEY = 'tevi_cs_state';
const TOKEN_KEY = 'tevi_cs_token';
const SEC_KEY   = 'tevi_cs_secrets';
const AI_BASE   = 'https://gateway.olagon.site/anthropic/v1';

// ── SECRETS ─────────────────────────────────────────────────────────────
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── CONFIG ────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const d = await chrome.storage.local.get('tevi_cs_config');
    return d.tevi_cs_config || getDefaultConfig();
  } catch { return getDefaultConfig(); }
}

function getDefaultConfig() {
  return {
    version: 1,
    persona: { name: 'Sukii', owner: 'Baby Val', tone: 'friendly' },
    behavior: { introWaitMinutes: 180, csMaxTurns: 3, idleMinutes: 30, readAfterReply: true },
    rules: getDefaultRules(),
  };
}

function getDefaultRules() {
  return [
    { id: 'vcs', priority: 10, type: 'keyword', active: true, match: 'vcs,videocall,video call,vc ,telfon,telpon,call,meet,zoom', reply: `VCS available 💕\nBisa payment ke https://babyval.com/\n➡️ Pilih Video Call\nJangan lupa kirim bukti TF ke DM\n\nAKU BALAS KHUSUS MEMBER ATAU SUDAH PAYMENT VCS` },
    { id: 'payment', priority: 10, type: 'keyword', active: true, match: 'payment,bayar,tf,transfer,donasi,donate,harga,price,berapa,cost', reply: `Untuk payment VCS:\n1. Buka https://babyval.com/\n2. Pilih Video Call\n3. Transfer ke rekening yang tertera\n4. Kirim bukti TF ke DM\n\nAku balas setelah payment terkonfirmasi ✅` },
    { id: 'join_member', priority: 10, type: 'keyword', active: true, match: 'join,member,membership,subscribe,langganan,premium', reply: `Mau jadi member Baby Val?\nKunjungi: tevi.com/@cutieval\nPilih membership yang tersedia.\nSetelah join, kamu bisa chat langsung dengan Baby Val! 💕` },
    { id: 'order', priority: 10, type: 'keyword', active: true, match: 'jual,beli,jasa,order,pembelian,buy', reply: `Untuk order:\n1. Buka https://babyval.com/\n2. Pilih layanan yang diinginkan\n3. Lakukan payment\n4. Kirim bukti ke DM\n\nAku bantu proses setelah payment masuk ✅` },
    { id: 'konten', priority: 10, type: 'keyword', active: true, match: 'foto,video,konten,pic,image,send,kirim,eksklusif', reply: `Konten eksklusif tersedia untuk member!\nJoin membership di tevi.com/@cutieval\natau cek di https://babyval.com/ untuk pilihan konten 💕` },
    { id: 'bot_sukii', priority: 10, type: 'keyword', active: true, match: 'bot,sukii,siapa kamu,siapa ini,ai,assistant', reply: `Aku Sukii, AI Assistant-nya Baby Val 💕\nAku bantu menjawab pertanyaan dan mengarahkan kamu ke layanan yang tepat.\nAda yang bisa aku bantu?` },
    { id: 'terima_kasih', priority: 10, type: 'keyword', active: true, match: 'terima kasih,thanks,thx,makasih,ok,oke,sip,sipp,bagus,nice', reply: `Sama-sama! 💕 Kalau ada pertanyaan lagi, jangan ragu chat ya~` },
    { id: 'redirect_ig', priority: 5, type: 'redirect', active: true, match: 'instagram,ig,freshlive,fresh', reply: `Untuk info lebih lanjut, cek:\n📱 Instagram: @babyval_official\n🌐 babyval.com\n\nAtau tanya di sini, aku bantu! 💕` },
    { id: 'block', priority: 1, type: 'block', active: true, match: 'sexs,cari pacar,kelamin,nude,bugil,porno,sara,politik,judi,slot', reply: `Maaf ya, topik itu di luar layanan yang bisa aku bantu 💕\nCoba tanyakan soal VCS, membership, atau konten Baby Val ya~` },
    { id: 'fallback', priority: 0, type: 'fallback', active: true, match: '', reply: `Maaf ya, aku Sukii AI Assistant-nya Baby Val 💕\nAku hanya bisa bantu untuk:\n• Info VCS / Video Call\n• Cara join membership\n• Payment & order\n• Info konten eksklusif\n\nCoba tanya yang berkaitan dengan layanan di atas ya~` },
  ];
}

function findReply(text, rules) {
  if (!text) return null;
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (!rule.active) continue;
    if (rule.type === 'fallback') return rule;
    const kw = rule.match.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    const lower = text.toLowerCase();
    if (kw.some(k => lower.includes(k))) return rule;
  }
  return null;
}

function fmtReply(tpl, name) { return tpl.replace(/{name}/g, name || 'kak'); }

// ── AI ENRICHMENT ────────────────────────────────────────────────────────
async function aiEnrich(baseReply, message) {
  const cfg = await loadConfig();
  if (!cfg.behavior?.aiEnabled) return baseReply;
  const sec = await getSecrets();
  const key = sec?.aiKey;
  if (!key) return baseReply;

  const SYSTEM = `Kamu Sukii, AI Assistant milik Baby Val. Ubah jawaban template ini jadi lebih natural dan conversational dalam Bahasa Indonesia. Pertahankan informasi pentingnya tapi buat lebih friendly dan sesuai konteks. Max 3 kalimat, pakai emoji 💕.`;

  try {
    const resp = await fetch(`${AI_BASE}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 200, temperature: 0.7,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Template: "${baseReply}"\nSender: "${message}"` }],
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      const t = json.content?.[0]?.text?.trim();
      if (t) { log(`[AI] ✨ "${t.substring(0,50)}"`); return t; }
    }
  } catch {}
  return baseReply;
}

// ── DOM SEND ────────────────────────────────────────────────────────────
async function domSend(text, slug) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://tevi.com/*' });
    if (!tabs.length) { logE('[DOM] No tevi tab open'); return false; }
    const tab = tabs[0];
    log(`[DOM] → @${slug}: "${text.substring(0,40)}..."`);
    const resp = await chrome.tabs.sendMessage(tab.id, { type: 'DOM_SEND', text, slug });
    if (resp?.ok) { log(`[DOM] ✅ Sent to @${slug}`); return true; }
    logE(`[DOM] ❌ ${resp?.reason || 'failed'}`);
    return false;
  } catch (e) { logE(`[DOM] Error: ${e.message}`); return false; }
}

// ── HMAC ─────────────────────────────────────────────────────────────────
async function hmac(pathname) {
  const sec = await getSecrets();
  const SECRET = sec.hmacSecret || 'PRDKqnSNCKrMDF9hAt0PSJ6';
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(pathname + ts);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, data))));
  return `${ts}-${sig}`;
}

// ── GET CONVERSATIONS ───────────────────────────────────────────────────
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
  } catch (e) { logE(`[API] ❌ ${e.message}`); return { data: null, error: 'network_error' }; }
}

async function markRead(convId) {
  const t = await ensureToken();
  if (!t) return;
  const path = `/messenger/v2/conversation/${convId}/read/`;
  const verify = await hmac(path);
  try {
    await fetch(`https://wapi.flowstreamx.com${path}?verify=${verify}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${t}`, 'Origin': 'https://tevi.com' },
    });
  } catch {}
}

// ── STATE ────────────────────────────────────────────────────────────────
const DEF = () => ({
  botEnabled: false,
  convMeta: {},   // convId -> { stage, introAt, turns, lastText, lastReply, done }
  knownSenders: {},
  lastResult: null,
});

async function loadState() {
  try {
    const d = await chrome.storage.local.get(STATE_KEY);
    const s = d[STATE_KEY];
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return { ...DEF(), ...s, convMeta: { ...DEF().convMeta, ...(s.convMeta || {}) }, knownSenders: { ...DEF().knownSenders, ...(s.knownSenders || {}) } };
    }
  } catch {}
  return DEF();
}

async function saveState(s) { try { await chrome.storage.local.set({ [STATE_KEY]: s }); } catch {} }
async function isEnabled()  { const s = await loadState(); return !!s.botEnabled; }
async function setEnabled(v){ const s = await loadState(); s.botEnabled = v; await saveState(s); }

// ── POLL ────────────────────────────────────────────────────────────────
const POLL_MIN = 3;
const ALARM    = 'tevi-poll';

async function poll() {
  const start = Date.now();
  const hour  = new Date().getHours();
  const active = hour >= 17 || hour < 5;
  logD(`[POLL] active=${active}`);

  const state = await loadState();
  const cfg  = await loadConfig();
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
  log(`[POLL] ${convs.length} unread — active=${active}`);

  if (!active) {
    await saveState({ ...state, lastResult: { convs: convs.length, processed: 0, replied: 0, ignored: convs.length, dry: true, time: new Date().toISOString() } });
    return;
  }

  let processed = 0, replied = 0, ignored = 0;
  const maxTurns   = cfg.behavior?.csMaxTurns || 3;
  const idleMs    = (cfg.behavior?.idleMinutes || 30) * 60 * 1000;
  const introWait = (cfg.behavior?.introWaitMinutes || 180) * 60 * 1000;
  const rules     = cfg.rules || [];
  const greeting = cfg.persona?.greeting || 'Halo! Aku Sukii, AI Assistant-nya Baby Val 💕';

  for (const conv of convs) {
    const convId    = conv.id;
    if (!convId) { processed++; continue; }

    const rcv       = conv.recipient || {};
    const msg       = conv.latest_message || {};
    const text      = msg.text || '';
    const senderUid = msg.sender?.uid || '';
    const slug      = rcv.channel_slug || '?';
    const isSub     = rcv.is_my_subscriber === true;
    const meta      = state.convMeta[convId] || {};
    const stage     = meta.stage || 'new';

    processed++;

    // ── MEMBER: never touch ─────────────────────────────────────────────
    if (isSub) {
      if (stage !== 'member') { state.convMeta[convId] = { ...meta, stage: 'member', done: true }; }
      logD(`  @${slug} [member] skipped`);
      ignored++;
      continue;
    }

    // ── OWN MESSAGE ────────────────────────────────────────────────────
    if (senderUid === MY_UID) { ignored++; continue; }

    state.knownSenders[senderUid] = Date.now();

    // ── DONE: stop replying ────────────────────────────────────────────
    if (meta.done) {
      logD(`  @${slug} [done] ignored`);
      ignored++;
      continue;
    }

    // ── STAGE: intro_sent ─────────────────────────────────────────────
    if (stage === 'intro_sent') {
      const elapsed = Date.now() - (meta.introAt || 0);
      const waitExpired = elapsed >= introWait;

      if (text && text !== meta.lastText) {
        // User replied! → CS mode
        log(`  @${slug} [intro→CS] replied: "${text.substring(0,30)}"`);
        const rule = findReply(text, rules);
        let replyText = rule ? fmtReply(rule.reply, slug) : fmtReply(rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
        replyText = await aiEnrich(replyText, text);
        const sent = await domSend(replyText, slug);
        if (sent) {
          state.convMeta[convId] = { ...meta, stage: 'cs', turns: 1, lastText: text, lastReply: replyText, introAt: meta.introAt };
          replied++;
        } else { ignored++; }
      } else if (waitExpired) {
        // 3h passed without reply → done
        log(`  @${slug} [intro→done] timeout (${Math.round(elapsed/60000)}m)`);
        state.convMeta[convId] = { ...meta, stage: 'cs', done: true };
        ignored++;
      } else {
        logD(`  @${slug} [intro_sent] waiting (${Math.round(elapsed/60000)}m/${introWait/60000}m)`);
        ignored++;
      }
      continue;
    }

    // ── STAGE: cs (CS conversation) ────────────────────────────────────
    if (stage === 'cs') {
      if (text && text !== meta.lastText) {
        // New message → count as new turn
        const newTurns = (meta.turns || 0) + 1;
        log(`  @${slug} [CS turn ${newTurns}/${maxTurns}] "${text.substring(0,30)}"`);

        if (newTurns > maxTurns) {
          // Max turns reached → done
          log(`  @${slug} [CS→done] max turns reached`);
          state.convMeta[convId] = { ...meta, turns: newTurns, lastText: text, done: true };
          await markRead(convId);
          ignored++;
          continue;
        }

        // Find and send reply
        const rule = findReply(text, rules);
        let replyText = rule ? fmtReply(rule.reply, slug) : fmtReply(rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
        replyText = await aiEnrich(replyText, text);
        const sent = await domSend(replyText, slug);

        if (sent) {
          state.convMeta[convId] = { ...meta, turns: newTurns, lastText: text, lastReply: replyText };
          replied++;
        } else { ignored++; }
      } else {
        // Same message (no new), check idle
        const idleElapsed = Date.now() - (meta.lastActivityAt || meta.introAt || Date.now());
        if (idleElapsed >= idleMs) {
          log(`  @${slug} [CS→done] idle timeout (${Math.round(idleElapsed/60000)}m)`);
          state.convMeta[convId] = { ...meta, done: true };
          ignored++;
        } else {
          logD(`  @${slug} [CS turn ${meta.turns}] waiting (${Math.round(idleElapsed/60000)}m idle)`);
          ignored++;
        }
      }
      continue;
    }

    // ── STAGE: new ────────────────────────────────────────────────────
    log(`  @${slug} [new→intro] "${text.substring(0,40)}"`);
    const sent = await domSend(greeting, slug);
    if (sent) {
      state.convMeta[convId] = {
        stage: 'intro_sent', introAt: Date.now(),
        senderUid, lastText: text, turns: 0,
      };
      log(`  @${slug} [intro_sent] ✅ greeting sent`);
      replied++;
    } else {
      logE(`  @${slug} [new] ❌ greeting failed`);
      ignored++;
    }
  }

  const result = {
    processed, replied, ignored,
    convs: convs.length, dry: false,
    time: new Date().toISOString(), durationMs: Date.now() - start,
    stats: {
      activeConvs: Object.values(state.convMeta).filter(m => m.stage === 'cs' && !m.done).length,
      doneConvs:   Object.values(state.convMeta).filter(m => m.done).length,
      introSent:   Object.values(state.convMeta).filter(m => m.stage === 'intro_sent').length,
    },
  };

  await saveState({ ...state, lastResult: result });
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
    Promise.all([loadState(), loadConfig(), ensureToken()]).then(([state, cfg]) => {
      send({
        enabled: state.botEnabled,
        result: state.lastResult || {},
        uid, hasToken: !!token,
        activeHours: new Date().getHours() >= 17 || new Date().getHours() < 5,
        stats: state.lastResult?.stats || {},
        config: {
          rulesCount: cfg.rules?.length || 0,
          aiEnabled: cfg.behavior?.aiEnabled || false,
          maxTurns: cfg.behavior?.csMaxTurns || 3,
        },
      });
    });
    return true;
  }

  if (msg.type === 'TOGGLE') {
    setEnabled(msg.enabled).then(async () => {
      if (msg.enabled) {
        chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
        log('[TOGGLE] ON');
        await poll();
      } else {
        chrome.alarms.cancel(ALARM);
        log('[TOGGLE] OFF');
      }
      send({ ok: true });
    });
    return true;
  }

  if (msg.type === 'GET_CONFIG') {
    loadConfig().then(cfg => send(cfg));
    return true;
  }

  if (msg.type === 'SAVE_CONFIG') {
    const errors = [];
    if (!msg.config?.persona?.name) errors.push('Persona name required');
    if (!Array.isArray(msg.config?.rules)) errors.push('Rules must be array');
    if (errors.length) { send({ ok: false, errors }); return true; }
    chrome.storage.local.set({ tevi_cs_config: msg.config }).then(() => {
      log(`[CONFIG] Saved — ${msg.config.rules.length} rules`);
      send({ ok: true });
    });
    return true;
  }

  if (msg.type === 'SET_SECRETS') {
    _secrets = msg.secrets;
    chrome.storage.local.set({ [SEC_KEY]: msg.secrets }).then(() => {
      log('[CONFIG] Secrets updated');
      send({ ok: true });
    });
    return true;
  }

  if (msg.type === 'RESET_STATE') {
    chrome.storage.local.set({ [STATE_KEY]: DEF() }).then(() => {
      log('[STATE] Reset');
      send({ ok: true });
    });
    return true;
  }

  if (msg.type === 'OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {});
    return true;
  }
});

// ── STARTUP ───────────────────────────────────────────────────────────────
(async () => {
  log('[SW] Tevi CS Bot v0.5.1.0 — config-driven');
  await loadToken();
  if (await isEnabled()) {
    chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
    log('[SW] Was enabled — poll scheduled');
    setTimeout(async () => { if (await isEnabled()) await poll(); }, 2000);
  }
})();
