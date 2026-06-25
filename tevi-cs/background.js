/**
 * BACKGROUND — Service Worker Tevi CS Bot v0.7.2
 * Conv queue: process ONE conversation at a time
 * Page-load guard: wait for page ready before typing (slow laptop aware)
 * Send guard: confirm message sent before next task
 * Sukii must always be last replier
 */

const MY_UID    = '392388705';
const LOG       = 'http://localhost:3131';
const STATE_KEY = 'tevi_cs_state';
const TOKEN_KEY = 'tevi_cs_token';
const SEC_KEY   = 'tevi_cs_secrets';
const AI_BASE   = 'https://gateway.olagon.site/anthropic/v1';
const OVERLAY_KEY = 'tevi_cs_overlay_state';

// ── OVERLAY STATE ─────────────────────────────────────────────────────────
async function setOverlay(updates) {
  try {
    const d = await chrome.storage.local.get(OVERLAY_KEY);
    await chrome.storage.local.set({ [OVERLAY_KEY]: { ...(d[OVERLAY_KEY] || {}), ...updates } });
  } catch {}
}

function signalTyping(text, slug) {
  setOverlay({ typing: true, typingText: text, typingSlug: slug });
}
function signalNewMessage(text, slug) {
  setOverlay({ newMessage: text, newSlug: slug });
}
function clearOverlay() {
  setOverlay({ typing: false, typingText: '', newMessage: '' });
}

// ── SECRETS ──────────────────────────────────────────────────────────────
let _secrets = null;
async function getSecrets() {
  if (_secrets) return _secrets;
  try {
    const d = await chrome.storage.local.get(SEC_KEY);
    _secrets = d[SEC_KEY] || {};
  } catch { _secrets = {}; }
  return _secrets;
}

// ── LOGGING ───────────────────────────────────────────────────────────────
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

// ── CONFIG ───────────────────────────────────────────────────────────────
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
    behavior: { csMaxTurns: 3, idleMinutes: 30, readAfterReply: true },
    rules: getDefaultRules(),
  };
}

function getDefaultRules() {
  return [
    { id: 'block_personal',   priority: 50, type: 'keyword', active: true, match: 'alamat rumah,no hp,nomor hp,wa ,whatsapp,umur kamu,berapa umur,usia kamu,domisili,kota kamu,daerah kamu', reply: `Informasi pribadi tidak diberikan.` },
    { id: 'offline_ketemu',   priority: 45, type: 'keyword', active: true, match: 'ketemu,bertemu,langsung,offline,nemu,dateng,datang,meet up,nyambung,in person,temu muka', reply: `Cuma bisa VCS. Offline tidak tersedia.` },
    { id: 'vcs_cara',         priority: 40, type: 'keyword', active: true, match: 'cara vcs,cara payment,cara bayarnya,cara order,bagaimn cara,gimana cara,cara nya', reply: `1. Buka babyval.com\n2. Pilih Video Call\n3. Pilih Durasi\n4. Bayar` },
    { id: 'durasi_7_10',      priority: 35, type: 'keyword', active: true, match: 'beda 7 dan 10,beda 10 sama 7,7 menit 10 menit,10 menit 7 menit,bedanya apa 7,selisih 7 dan 10', reply: `Beda durasi aja. Squirt minimal 20 menit.` },
    { id: 'masker',           priority: 35, type: 'keyword', active: true, match: 'buka masker,lepas masker,pake masker,tanpa masker', reply: `Buka masker: tip 250rb ke ganknow.com/babyval/tip. Masker diganti penutup mata.` },
    { id: 'vcs',              priority: 30, type: 'keyword', active: true, match: 'vcs,videocall,video call,vc ,telfon,telpon,call,meet,zoom', reply: `VCS tersedia. babyval.com → Video Call → Durasi → Bayar.` },
    { id: 'chat_males',       priority: 25, type: 'keyword', active: true, match: 'doang,aja sih,santai aja,cuma ngobrol,bsa ngobrol gk,sih gk,santai aja kak', reply: `Chat langsung: membership Tevi.` },
    { id: 'payment',          priority: 20, type: 'keyword', active: true, match: 'payment,bayar,tf,transfer,donasi,donate,harga,price,berapa,cost', reply: `babyval.com → Video Call → Durasi → Bayar. Transfer, kirim bukti ke DM.` },
    { id: 'join_member',      priority: 20, type: 'keyword', active: true, match: 'join,member,membership,subscribe,langganan,premium', reply: `tevi.com/@cutieval. Pilih membership yang tersedia.` },
    { id: 'order',            priority: 15, type: 'keyword', active: true, match: 'jual,beli,jasa,order,pembelian,buy', reply: `babyval.com. Pilih layanan, bayar, kirim bukti.` },
    { id: 'konten',           priority: 15, type: 'keyword', active: true, match: 'foto,video,konten,pic,image,send,kirim,eksklusif', reply: `Konten untuk member. tevi.com/@cutieval atau babyval.com.` },
    { id: 'bot_sukii',        priority: 10, type: 'keyword', active: true, match: 'bot,sukii,siapa kamu,siapa ini,ai,assistant', reply: `Sukii. Informan Baby Val.` },
    { id: 'terima_kasih',     priority: 5,  type: 'keyword', active: true, match: 'terima kasih,thanks,thx,makasih,sip,sipp,bagus,nice', reply: `Sukii. Ada yang perlu ditanyakan soal VCS atau membership.` },
    { id: 'block_inap',       priority: 1,  type: 'block',   active: true, match: 'sexs,cari pacar,kelamin,nude,bugil,porno,sara,politik,judi,slot,lubang', reply: `Di luar layanan.` },
    { id: 'fallback',         priority: 0,  type: 'fallback', active: true, match: '', reply: `Chat langsung dengan Baby Val: membership Tevi.` },
  ];
}

function findReply(text, rules) {
  if (!text) return null;
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (!rule.active) continue;
    if (rule.type === 'fallback') return rule;
    const kw = rule.match.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (kw.some(k => text.toLowerCase().includes(k))) return rule;
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

  const SYSTEM = `Kamu Sukii, informan milik Baby Val. Jawaban: singkat, dingin, informatif. Tidak ramah, tidak ikut-ikutan. Tiap pesan langsung to the point. Bahasa Indonesia. Maks 2 kalimat.`;

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
      if (t) { log(`[AI] "${t.substring(0, 50)}"`); return t; }
    }
  } catch {}
  return baseReply;
}

// ── PAGE LOAD DETECTION ──────────────────────────────────────────────────
// Waits until content-script is ready on tevi tab
async function waitForPageReady(tabId, slug, maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (r?.ok) return true;
    } catch {}
    await sleep(1000);
  }
  logD(`[WAIT] Page not ready after ${maxWaitMs}ms for @${slug}`);
  return false;
}

// ── SEND CONFIRMATION ────────────────────────────────────────────────────
async function domSendWithConfirm(text, slug, maxWaitMs = 20000) {
  // ALWAYS get fresh tab — tabId goes stale after navigation
  const tab = await getTeviTab();
  if (!tab) { logE('[SEND] No tevi tab'); return false; }
  const tabId = tab.id;

  log(`[SEND] → @${slug}: "${text.substring(0, 40)}..."`);

  // Attempt 1: direct
  try {
    const r1 = await chrome.tabs.sendMessage(tabId, { type: 'DOM_SEND', text, slug });
    if (r1?.ok) { log(`[SEND] ✅ @${slug} sent`); return true; }
  } catch (e) { logD(`[SEND] direct fail: ${e.message}`); }

  // Attempt 2: inject CS + retry (slow laptop needs more time)
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
    await sleep(4000);
    const r2 = await chrome.tabs.sendMessage(tabId, { type: 'DOM_SEND', text, slug });
    if (r2?.ok) { log(`[SEND] ✅ @${slug} sent (after inject)`); return true; }
  } catch (e) { logD(`[SEND] inject fail: ${e.message}`); }

  // Attempt 3: hard refresh + wait + retry
  try {
    await chrome.tabs.reload(tabId, { bypassCache: true });
    await sleep(5000);
    await chrome.tabs.update(tabId, { url: `https://tevi.com/@${slug}/messages` });
    await sleep(5000);
    const r3 = await chrome.tabs.sendMessage(tabId, { type: 'DOM_SEND', text, slug });
    if (r3?.ok) { log(`[SEND] ✅ @${slug} sent (after refresh)`); return true; }
  } catch (e) { logD(`[SEND] refresh fail: ${e.message}`); }

  logE(`[SEND] ❌ All attempts failed for @${slug}`);
  return false;
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

// ── API ──────────────────────────────────────────────────────────────────
async function getConvs() {
  const t = await ensureToken();
  if (!t) return { data: null, error: 'no_token' };
  const path = '/messenger/v2/rpc/get_recent_conversations';
  const verify = await hmac(path);
  const url = `https://wapi.flowstreamx.com${path}?limit=100&verify=${verify}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${t}`, 'Origin': 'https://tevi.com', 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      if (json?.success) {
        const n = json.data?.results?.length || 0;
        log(`[API] ${n} total convs`);
        return { data: json.data, error: null };
      }
    }
    return { data: null, error: 'api_failed' };
  } catch (e) { return { data: null, error: 'network_error' }; }
}

async function getMessages(convId) {
  const t = await ensureToken();
  if (!t) return null;
  const path = `/messenger/v2/conversation/${convId}/messages`;
  const verify = await hmac(path);
  try {
    const resp = await fetch(`https://wapi.flowstreamx.com${path}?limit=20&verify=${verify}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${t}`, 'Origin': 'https://tevi.com', 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      return json?.data?.messages || json?.messages || [];
    }
  } catch {}
  return null;
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
  convMeta: {},
  knownSenders: {},
  lastResult: null,
  // ── CONVERSATION QUEUE ──────────────────────────────────────────────
  // Processes ONE conv at a time to avoid tab collision
  queue: [],       // convId[] — pending convs to process
  queueDone: [],    // convId[] — recently processed (cooldown)
  queueBusy: false, // currently processing
});

async function loadState() {
  try {
    const d = await chrome.storage.local.get(STATE_KEY);
    const s = d[STATE_KEY];
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      return {
        ...DEF(), ...s,
        convMeta: { ...DEF().convMeta, ...(s.convMeta || {}) },
        queue: Array.isArray(s.queue) ? s.queue : [],
        queueDone: Array.isArray(s.queueDone) ? s.queueDone : [],
      };
    }
  } catch {}
  return DEF();
}

async function saveState(s) { try { await chrome.storage.local.set({ [STATE_KEY]: s }); } catch {} }
async function isEnabled()  { const s = await loadState(); return !!s.botEnabled; }
async function setEnabled(v){ const s = await loadState(); s.botEnabled = v; await saveState(s); }

// ── QUEUE HELPERS ────────────────────────────────────────────────────────
function enqueueConv(state, convId) {
  if (state.queue.includes(convId) || state.queueDone.includes(convId)) return false;
  state.queue.push(convId);
  return true;
}

function markQueueDone(state, convId) {
  state.queue = state.queue.filter(id => id !== convId);
  state.queueDone = [convId, ...state.queueDone].slice(0, 20); // keep last 20
}

function dequeueConv(state) {
  if (state.queueBusy || state.queue.length === 0) return null;
  state.queueBusy = true;
  return state.queue[0];
}

function releaseQueue(state) {
  if (state.queue.length > 0) {
    const next = state.queue[0];
    state.queueBusy = false;
    return next;
  }
  state.queueBusy = false;
  return null;
}

// ── IS SUKII? (recipient.id matches MY_UID) ───────────────────────────────
// API returns recipient.id — compare against numeric MY_UID
function isSukiiMessage(recipient, senderUid) {
  // recipient.id = our UID (numeric string)
  // senderUid = the person who sent the message
  return recipient?.id === MY_UID;
}

// ── PAYMENT PROOF ────────────────────────────────────────────────────────
function isPaymentProof(msg) {
  if (!msg) return false;
  const t = (msg.text || '').toLowerCase();
  const textKws = ['bukti', 'transfer', 'pembayaran', 'bayar', 'tf', 'receipt', 'lunas', 'sudah transfer', 'udah transfer', 'sdh transfer'];
  const hasTextKw = textKws.some(k => t.includes(k));
  const hasImage = !!(msg.images?.length || (msg.attachments?.some && msg.attachments.some(a => a.type?.includes?.('image'))) || t.includes('[image]') || t.includes('foto'));
  return hasTextKw || hasImage;
}

// ── SUKII-LAST-REPLIER ───────────────────────────────────────────────────
function shouldSkipReply(meta, msgTime) {
  if (!meta) return false;
  const now = Date.now();

  // Rule: Sukii was last → user following up on Sukii's message → skip
  if (meta.sukiiLastReplyAt && meta.sukiiLastReplyAt >= (meta.userLastMsgAt || 0)) {
    return true;
  }

  // Rule: User silent >24h → wake them up
  const userAge = now - (meta.userLastMsgAt || msgTime || now);
  if (userAge > 24 * 60 * 60 * 1000) return false;

  // Rule: Payment confirmed, <6h passed → wait
  if (meta.paymentConfirmedAt && now - meta.paymentConfirmedAt < 6 * 60 * 60 * 1000) {
    return true;
  }

  return false;
}

// ── GET TEVI TAB ─────────────────────────────────────────────────────────
async function getTeviTab() {
  const tabs = await chrome.tabs.query({ url: '*://tevi.com/*' });
  return tabs.find(t => !t.url.includes('/settings')) || tabs[0] || null;
}

// ── NAVIGATE TO CONV ─────────────────────────────────────────────────────
async function navigateToConv(slug) {
  // ALWAYS get fresh tab — tabId goes stale after navigation
  const tab = await getTeviTab();
  if (!tab) return false;
  const tabId = tab.id;

  const targetUrl = `https://tevi.com/@${slug}/messages`;

  // If already on correct URL and CS is ready, done
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (r?.ok && r?.url?.includes(`/@${slug}`)) return true;
  } catch {}

  // Navigate to target
  try {
    await chrome.tabs.update(tabId, { url: targetUrl, active: true });
  } catch { return false; }

  // Wait for page to load — Tevi is heavy, slow laptop needs more time
  // First: wait for tab URL to actually change
  await sleep(5000);

  // Second: try to get CS ready
  let ready = await waitForPageReady(tabId, slug, 15000);
  if (!ready) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
      await sleep(3000);
      ready = await waitForPageReady(tabId, slug, 15000);
    } catch {}
  }

  return ready;
}

// ── PROCESS ONE CONVERSATION ─────────────────────────────────────────────
async function processOneConv(conv, state, cfg) {
  const convId  = conv.id;
  const rcv     = conv.recipient || {};
  const msg     = conv.latest_message || {};
  const text    = msg.text || '';
  const slug    = rcv.channel_slug || convId || '?';
  const isSub   = rcv.is_my_subscriber === true;
  const meta    = state.convMeta[convId] || {};
  const stage   = meta.stage || 'new';

  let msgTime = Date.now();
  if (msg?.created_at) {
    const ts = Number(msg.created_at) * 1000;
    if (ts > 1700000000000) msgTime = ts;
  }

  // ── MEMBER: never touch ──────────────────────────────────────────────
  if (isSub) {
    if (stage !== 'member') state.convMeta[convId] = { ...meta, stage: 'member', done: true, membershipAt: Date.now() };
    logD(`  @${slug} [member] skipped`);
    markQueueDone(state, convId);
    return { action: 'ignored', reason: 'member' };
  }

  // ── OWN MESSAGE (recipient is me → I sent this) ─────────────────────
  if (isSukiiMessage(rcv, msg.sender?.uid)) {
    if (text && meta.lastReply === text) {
      state.convMeta[convId] = { ...meta, sukiiLastReplyAt: msgTime };
      clearOverlay();
    }
    markQueueDone(state, convId);
    return { action: 'ignored', reason: 'own_message' };
  }

  // ── DONE: stop replying ────────────────────────────────────────────
  if (meta.done) {
    markQueueDone(state, convId);
    return { action: 'ignored', reason: 'done' };
  }

  // ── Navigate to DM ─────────────────────────────────────────────────
  const ready = await navigateToConv(slug);
  if (!ready) {
    logE(`[QUEUE] Could not ready @${slug} — deferring`);
    releaseQueue(state);
    return { action: 'deferred', reason: 'not_ready' };
  }

  // ── STAGE: new ─────────────────────────────────────────────────────
  if (stage === 'new') {
    const greeting = `Halo aku Sukii, AI Assistant-nya Baby Val 💕\nKalau mau Chat sama Baby Val, membership dulu ya di Tevi\nKalau mau VCS bisa bayar di babyval.com`;
    signalNewMessage(`Hai @${slug}!`, slug);
    const sent = await domSendWithConfirm(greeting, slug);
    if (sent) {
      state.convMeta[convId] = {
        slug, stage: 'intro_sent', introAt: Date.now(),
        lastText: text, turns: 0,
        sukiiLastReplyAt: Date.now(),
        userLastMsgAt: msgTime,
      };
      log(`  @${slug} [intro_sent] ✅ greeting sent`);
      markQueueDone(state, convId);
      return { action: 'replied', greeting: true };
    } else {
      logE(`  @${slug} [new] ❌ greeting failed`);
      releaseQueue(state);
      return { action: 'failed', reason: 'send_failed' };
    }
  }

  // ── STAGE: intro_sent ─────────────────────────────────────────────
  if (stage === 'intro_sent') {
    if (isPaymentProof(msg)) {
      log(`  @${slug} [intro→done] payment proof — silent end`);
      state.convMeta[convId] = { ...meta, done: true, lastText: text, paymentConfirmedAt: Date.now() };
      markQueueDone(state, convId);
      return { action: 'silent_end', reason: 'payment' };
    }
    if (!text || text === meta.lastText) {
      logD(`  @${slug} [intro_sent] waiting for reply...`);
      markQueueDone(state, convId);
      return { action: 'ignored', reason: 'no_new_msg' };
    }
    // User replied → CS mode
    log(`  @${slug} [intro→CS] replied: "${text.substring(0, 30)}"`);
    const rule = findReply(text, cfg.rules);
    let replyText = fmtReply(rule?.reply || cfg.rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
    replyText = await aiEnrich(replyText, text);
    signalTyping(replyText, slug);
    const sent = await domSendWithConfirm(replyText, slug);
    clearOverlay();
    if (sent) {
      state.convMeta[convId] = {
        ...meta, slug,
        stage: 'cs', turns: 1,
        lastText: text, lastReply: replyText,
        sukiiLastReplyAt: Date.now(),
        userLastMsgAt: msgTime,
      };
      markQueueDone(state, convId);
      return { action: 'replied', greeting: false };
    } else {
      releaseQueue(state);
      return { action: 'failed', reason: 'send_failed' };
    }
  }

  // ── STAGE: cs ─────────────────────────────────────────────────────
  if (stage === 'cs') {
    if (isPaymentProof(msg)) {
      log(`  @${slug} [CS→done] payment proof — silent end`);
      state.convMeta[convId] = { ...meta, done: true, lastText: text, paymentConfirmedAt: Date.now() };
      markQueueDone(state, convId);
      return { action: 'silent_end', reason: 'payment' };
    }
    if (!text || text === meta.lastText) {
      const idleMs = (cfg.behavior?.idleMinutes || 30) * 60 * 1000;
      const idleElapsed = Date.now() - (meta.lastActivityAt || meta.sukiiLastReplyAt || Date.now());
      if (idleElapsed >= idleMs) {
        log(`  @${slug} [CS→done] idle timeout`);
        state.convMeta[convId] = { ...meta, done: true };
        markQueueDone(state, convId);
        return { action: 'done', reason: 'idle_timeout' };
      }
      markQueueDone(state, convId);
      return { action: 'ignored', reason: 'no_new_msg' };
    }
    // New user message
    const newMeta = { ...meta, userLastMsgAt: msgTime, lastText: text };
    state.convMeta[convId] = newMeta;

    if (shouldSkipReply(newMeta, msgTime)) {
      log(`  @${slug} [CS→skip] Sukii was last replier`);
      markQueueDone(state, convId);
      return { action: 'ignored', reason: 'sukii_last' };
    }

    const maxTurns = cfg.behavior?.csMaxTurns || 3;
    const newTurns = (meta.turns || 0) + 1;
    log(`  @${slug} [CS turn ${newTurns}/${maxTurns}] "${text.substring(0, 30)}"`);

    let replyText;
    if (newTurns > maxTurns) {
      const greeting = `Halo aku Sukii, AI Assistant-nya Baby Val 💕\nKalau mau Chat sama Baby Val, membership dulu ya di Tevi\nKalau mau VCS bisa bayar di babyval.com`;
      replyText = greeting;
      signalNewMessage(`Loop @${slug}`, slug);
    } else {
      const rule = findReply(text, cfg.rules);
      replyText = fmtReply(rule?.reply || cfg.rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
      replyText = await aiEnrich(replyText, text);
      signalTyping(replyText, slug);
    }

    const sent = await domSendWithConfirm(replyText, slug);
    clearOverlay();

    if (sent) {
      state.convMeta[convId] = {
        ...newMeta,
        stage: newTurns > maxTurns ? 'intro_sent' : 'cs',
        turns: newTurns > maxTurns ? 0 : newTurns,
        lastReply: replyText,
        sukiiLastReplyAt: Date.now(),
        introAt: newTurns > maxTurns ? Date.now() : meta.introAt,
      };
      markQueueDone(state, convId);
      return { action: 'replied', greeting: newTurns > maxTurns };
    } else {
      releaseQueue(state);
      return { action: 'failed', reason: 'send_failed' };
    }
  }

  markQueueDone(state, convId);
  return { action: 'ignored', reason: 'unknown_stage' };
}

// ── POLL ─────────────────────────────────────────────────────────────────
const POLL_MIN = 3;
const ALARM    = 'tevi-poll';
const BASE_DELAY = 8000; // base delay between queue tasks

async function poll() {
  const start = Date.now();

  const state = await loadState();
  const cfg   = await loadConfig();

  // Write botEnabled + activeHours to overlay storage for cat panel sync
  const hour = new Date().getHours();
  await setOverlay({
    botEnabled: state.botEnabled,
    activeHours: true,       // 24/7 mode
    activeHoursRaw: hour,
  });

  // ── First: check TRACKED convs (greeting sent, conv dropped from unread) ──
  const tracked = Object.entries(state.convMeta)
    .filter(([id, m]) => !m.done && (m.stage === 'intro_sent' || m.stage === 'cs'))
    .map(([id, m]) => ({ convId: id, ...m }));

  for (const tc of tracked) {
    // Skip if also in current unread list
    const messages = await getMessages(tc.convId);
    if (!messages?.length) continue;

    const latest  = messages[messages.length - 1];
    const lText   = latest?.text || '';
    const lTime   = latest?.created_at ? Number(latest.created_at) * 1000 : Date.now();
    if (lText === tc.lastText || !lText) continue;

    const tab = await getTeviTab();
    if (!tab) { logE('[POLL] No tevi tab for tracked conv'); continue; }

    // Determine sender — compare recipient.id (our UID) vs sender uid
    const senderUid = latest?.sender?.uid || '';
    const isMe = latest?.sender?.is_me || false;

    // If we sent it (is_me=true or sender uid = MY_UID), update sukiiLastReplyAt
    if (isMe || senderUid === MY_UID) {
      state.convMeta[tc.convId] = { ...state.convMeta[tc.convId], sukiiLastReplyAt: lTime };
      continue;
    }

    // New user reply in tracked conv
    log(`  [tracked @${tc.slug || tc.convId}] user replied: "${lText.substring(0, 30)}"`);
    const slug = tc.slug || tc.convId;

    if (shouldSkipReply(state.convMeta[tc.convId], lTime)) {
      log(`  @${slug} [skip] Sukii was last replier`);
      continue;
    }

    const newMeta = { ...state.convMeta[tc.convId], userLastMsgAt: lTime, lastText: lText };
    const rule = findReply(lText, cfg.rules);
    let replyText = fmtReply(rule?.reply || cfg.rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
    replyText = await aiEnrich(replyText, lText);
    signalTyping(replyText, slug);
    const sent = await domSendWithConfirm(replyText, slug);
    clearOverlay();
    if (sent) {
      state.convMeta[tc.convId] = { ...newMeta, stage: 'cs', turns: 1, lastReply: replyText, sukiiLastReplyAt: Date.now() };
    }
    await sleep(BASE_DELAY);
  }

  // ── Queue-based processing of new convs ──────────────────────────────
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

  const allConvs = convsResult.data.results || [];
  log(`[POLL] ${allConvs.length} total convs, queue=${state.queue.length}, busy=${state.queueBusy}`);

  // Discover new convs → add to queue
  let enqueued = 0;
  for (const conv of allConvs) {
    if (!conv.id) continue;
    const meta  = state.convMeta[conv.id] || {};
    const stage = meta.stage || 'new';
    // Only enqueue truly new convs
    if (stage === 'new' && !meta.done) {
      if (enqueueConv(state, conv.id)) enqueued++;
    }
  }
  if (enqueued > 0) log(`[QUEUE] Added ${enqueued} new convs → ${state.queue.length} total pending`);

  // Get tevi tab once for all queue processing
  const tab = await getTeviTab();
  if (!tab) {
    logE('[POLL] No tevi tab — cannot process queue');
    await saveState({ ...state, lastResult: { convs: allConvs.length, queue: state.queue.length, time: new Date().toISOString() } });
    return;
  }

  // Process queue ONE AT A TIME
  let processed = 0, replied = 0, ignored = 0, failed = 0;
  while (true) {
    const nextConvId = dequeueConv(state);
    if (!nextConvId) break;

    const conv = allConvs.find(c => c.id === nextConvId);
    if (!conv) {
      markQueueDone(state, nextConvId);
      continue;
    }

    log(`[QUEUE] Processing @${conv.recipient?.channel_slug || nextConvId} (${state.queue.length} remaining)`);
    const result = await processOneConv(conv, state, cfg);
    processed++;

    if (result.action === 'replied') replied++;
    else if (result.action === 'ignored') ignored++;
    else if (result.action === 'failed' || result.action === 'deferred') {
      failed++;
      // Failed: don't re-mark done, it stays in queue via releaseQueue
      // Already handled inside processOneConv
    }

    // Dynamic delay: longer if greeting, shorter if simple reply
    const delay = result.action === 'replied' && result.greeting
      ? 12000   // greeting: 12s
      : result.action === 'replied'
        ? BASE_DELAY  // reply: 8s
        : result.action === 'deferred'
          ? 15000       // deferred (not ready): 15s before retry
          : 5000;       // ignored: 5s

    logD(`[QUEUE] Waiting ${delay}ms before next task...`);
    await sleep(delay);

    // Release and move to next
    releaseQueue(state);
  }

  const result = {
    processed, replied, ignored, failed,
    convs: allConvs.length,
    queueRemaining: state.queue.length,
    dry: false,
    time: new Date().toISOString(),
    durationMs: Date.now() - start,
    stats: {
      activeConvs: Object.values(state.convMeta).filter(m => m.stage === 'cs' && !m.done).length,
      doneConvs:   Object.values(state.convMeta).filter(m => m.done).length,
      introSent:   Object.values(state.convMeta).filter(m => m.stage === 'intro_sent').length,
    },
  };

  await saveState({ ...state, lastResult: result });
  await setOverlay({ pollTime: Date.now() });
  log(`[POLL] Done p=${processed} r=${replied} i=${ignored} f=${failed} (${result.durationMs}ms)`);
}

// ── TOGGLE via STORAGE (popup/offline fallback) ──────────────────────────
// MV3: popup → SW message fails when SW is suspended.
// Instead popup writes to storage, SW watches onChanged.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const t = changes['tevi_cs_toggle_req'];
  if (!t || !t.newValue) return;
  const { enabled } = t.newValue;
  await setEnabled(enabled);
  await setOverlay({ botEnabled: enabled });
  if (enabled) {
    chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
    log('[TOGGLE] ON (via storage) — queue mode active');
    await poll();
  } else {
    chrome.alarms.cancel(ALARM);
    log('[TOGGLE] OFF (via storage)');
  }
  // Acknowledge toggle so popup knows it worked
  await chrome.storage.local.set({ tevi_cs_toggle_ack: { enabled, ts: Date.now() } });
});

// ── ALARM ────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM) return;
  if (!(await isEnabled())) return;
  try { await poll(); } catch (e) { logE(`[ALARM] ${e.message}`); }
});

// ── MESSAGES ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, send) => {
  if (msg.type === 'GET_STATUS') {
    Promise.all([loadState(), loadConfig(), ensureToken()]).then(([state, cfg]) => {
      send({
        enabled: state.botEnabled,
        result: state.lastResult || {},
        uid, hasToken: !!token,
        activeHours: true,    // 24/7 mode — always active
        queueLen: state.queue.length,
        queueBusy: state.queueBusy,
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
      await setOverlay({ botEnabled: msg.enabled });
      if (msg.enabled) {
        chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
        log('[TOGGLE] ON — queue mode active');
        await poll();
      } else {
        chrome.alarms.cancel(ALARM);
        log('[TOGGLE] OFF');
      }
      send({ ok: true });
    });
    return true;
  }

  if (msg.type === 'GET_CONFIG') { loadConfig().then(cfg => send(cfg)); return true; }

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

// ── AUTO-RELOAD ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, send) => {
  if (msg.type === '__TEVI_RELOAD__') {
    log('[RELOAD] Reloading...');
    chrome.runtime.reload();
    send({ ok: true });
    return true;
  }
});

// ── STARTUP ─────────────────────────────────────────────────────────────
(async () => {
  log('[SW] Tevi CS Bot v0.7.3 — overlay sync, queueBusy reset, 24/7 mode');
  // Reset stale queue state so bot isn't frozen after SW wakes
  const prevState = await loadState();
  if (prevState.queueBusy || prevState.queue.length > 0) {
    log(`[START] Reset stale queue (busy=${prevState.queueBusy}, queue=${prevState.queue.length})`);
    prevState.queueBusy = false;
    prevState.queue = [];
    await saveState(prevState);
  }
  // Write activeHours=true to overlay storage so cat panel shows correct mode
  const hour = new Date().getHours();
  await setOverlay({ activeHours: true, activeHoursRaw: hour });
  await loadToken();
  if (await isEnabled()) {
    chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
    setTimeout(async () => { if (await isEnabled()) await poll(); }, 2000);
  }
})();
