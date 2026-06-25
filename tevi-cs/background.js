/**
 * BACKGROUND — Service Worker Tevi CS Bot v0.6.2
 * Config-driven: all behavior from tevi_cs_config
 * Flow: intro → CS turns → loop-to-greeting (annoying tactic)
 * Payment proof → silent end (no reply, no read)
 * Sukii must always be last replier — no unanswered unless: membership, payment, >24h
 * DOM typing for visible send + overlay cat state signaling
 * Auto-reload: listens for __TEVI_RELOAD__ message to force SW restart
 */

const MY_UID    = '392388705';
const LOG       = 'http://localhost:3131';
const STATE_KEY = 'tevi_cs_state';
const TOKEN_KEY = 'tevi_cs_token';
const SEC_KEY   = 'tevi_cs_secrets';
const AI_BASE   = 'https://gateway.olagon.site/anthropic/v1';
const OVERLAY_KEY = 'tevi_cs_overlay_state';

// ── OVERLAY STATE (cat UI) ────────────────────────────────────────────────
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
    behavior: { csMaxTurns: 3, idleMinutes: 30, readAfterReply: true },
    rules: getDefaultRules(),
  };
}

function getDefaultRules() {
  return [
    // Priority 50: ABSOLUTE BLOCKS
    { id: 'block_personal', priority: 50, type: 'keyword', active: true, match: 'alamat rumah,no hp,nomor hp,wa ,whatsapp,umur kamu,berapa umur,usia kamu,domisili,kota kamu,daerah kamu', reply: `Informasi pribadi tidak diberikan.` },

    // Priority 45: OFFLINE / KETEMU — block and redirect to VCS
    { id: 'offline_ketemu', priority: 45, type: 'keyword', active: true, match: 'ketemu,bertemu,langsung,offline,nemu,dateng,datang,meet up,nyambung,in person,temu muka', reply: `Cuma bisa VCS. Offline tidak tersedia.` },

    // Priority 40: VCS STEPS
    { id: 'vcs_cara', priority: 40, type: 'keyword', active: true, match: 'cara vcs,cara payment,cara bayarnya,cara order,bagaimn cara,gimana cara,cara nya', reply: `1. Buka babyval.com\n2. Pilih Video Call\n3. Pilih Durasi\n4. Bayar` },

    // Priority 35: DURASI 7 vs 10 MENIT
    { id: 'durasi_7_10', priority: 35, type: 'keyword', active: true, match: 'beda 7 dan 10,beda 10 sama 7,7 menit 10 menit,10 menit 7 menit,bedanya apa 7,selisih 7 dan 10', reply: `Beda durasi aja. Squirt minimal 20 menit.` },

    // Priority 35: MASKER
    { id: 'masker', priority: 35, type: 'keyword', active: true, match: 'buka masker,lepas masker,pake masker,tanpa masker', reply: `Buka masker: tip 250rb ke ganknow.com/babyval/tip. Masker diganti penutup mata.` },

    // Priority 30: GENERIC VCS
    { id: 'vcs', priority: 30, type: 'keyword', active: true, match: 'vcs,videocall,video call,vc ,telfon,telpon,call,meet,zoom', reply: `VCS tersedia. babyval.com → Video Call → Durasi → Bayar.` },

    // Priority 25: MEMBERSHIP CTA
    { id: 'chat_males', priority: 25, type: 'keyword', active: true, match: 'doang,aja sih,santai aja,cuma ngobrol,bsa ngobrol gk,sih gk,santai aja kak', reply: `Chat langsung: membership Tevi.` },

    // Priority 20: PAYMENT
    { id: 'payment', priority: 20, type: 'keyword', active: true, match: 'payment,bayar,tf,transfer,donasi,donate,harga,price,berapa,cost', reply: `babyval.com → Video Call → Durasi → Bayar. Transfer, kirim bukti ke DM.` },

    // Priority 20: JOIN MEMBERSHIP
    { id: 'join_member', priority: 20, type: 'keyword', active: true, match: 'join,member,membership,subscribe,langganan,premium', reply: `tevi.com/@cutieval. Pilih membership yang tersedia.` },

    // Priority 15: ORDER / BUY
    { id: 'order', priority: 15, type: 'keyword', active: true, match: 'jual,beli,jasa,order,pembelian,buy', reply: `babyval.com. Pilih layanan, bayar, kirim bukti.` },

    // Priority 15: KONTEN
    { id: 'konten', priority: 15, type: 'keyword', active: true, match: 'foto,video,konten,pic,image,send,kirim,eksklusif', reply: `Konten untuk member. tevi.com/@cutieval atau babyval.com.` },

    // Priority 10: BOT IDENTITY
    { id: 'bot_sukii', priority: 10, type: 'keyword', active: true, match: 'bot,sukii,siapa kamu,siapa ini,ai,assistant', reply: `Sukii. Informan Baby Val.` },

    // Priority 5: GREETINGS / CASUAL
    { id: 'terima_kasih', priority: 5, type: 'keyword', active: true, match: 'terima kasih,thanks,thx,makasih,sip,sipp,bagus,nice', reply: `Sukii. Ada yang perlu ditanyakan soal VCS atau membership.` },

    // Priority 1: BLOCK INAPPROPRIATE
    { id: 'block_inap', priority: 1, type: 'block', active: true, match: 'sexs,cari pacar,kelamin,nude,bugil,porno,sara,politik,judi,slot,lubang', reply: `Di luar layanan.` },

    // Priority 0: FALLBACK
    { id: 'fallback', priority: 0, type: 'fallback', active: true, match: '', reply: `Chat langsung dengan Baby Val: membership Tevi.` },
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
    const tabId = tab.id;
    log(`[DOM] → @${slug}: "${text.substring(0,40)}..."`);

    async function trySend() {
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: 'DOM_SEND', text, slug });
        if (resp?.ok) return true;
        logD(`[DOM] Send failed: ${resp?.reason}`); return false;
      } catch (e) { logD(`[DOM] Port error: ${e.message}`); return false; }
    }

    // Attempt 1: direct
    if (await trySend()) { log(`[DOM] ✅ Sent to @${slug}`); return true; }

    // Attempt 2: CS may be navigating — wait and retry
    logD(`[DOM] Retrying after 3s...`);
    await sleep(3000);
    if (await trySend()) { log(`[DOM] ✅ Sent to @${slug} (retry)`); return true; }

    // Attempt 3: inject fresh CS + retry
    logD(`[DOM] Injecting CS + retry...`);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
      await sleep(2000);
      if (await trySend()) { log(`[DOM] ✅ Sent (after inject)`); return true; }
    } catch (e) { logD(`[DOM] Inject failed: ${e.message}`); }

    // Attempt 4: hard refresh + navigate to DM + retry
    logD(`[DOM] Hard refreshing + navigating...`);
    try {
      await chrome.tabs.reload(tabId, { bypassCache: true });
      await sleep(4000);
      await chrome.tabs.update(tabId, { url: `https://tevi.com/@${slug}/messages` });
      await sleep(3000);
      if (await trySend()) { log(`[DOM] ✅ Sent (after hard refresh)`); return true; }
    } catch (e) { logD(`[DOM] Hard refresh failed: ${e.message}`); }

    logE(`[DOM] ❌ All attempts failed for @${slug}`);
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
  const url = `https://wapi.flowstreamx.com${path}?limit=100&verify=${verify}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${t}`, 'Origin': 'https://tevi.com', 'Accept': 'application/json' },
    });
    if (resp.ok) {
      const json = await resp.json().catch(() => null);
      if (json?.success) {
        log(`[API] ✅ ${json.data?.results?.length || 0} total convs`);
        if (json.data?.results?.length > 0) {
          logD(`[API] first conv: ${JSON.stringify(Object.keys(json.data.results[0]))}`);
          logD(`[API] first conv.last_msg.sender: ${JSON.stringify(json.data.results[0]?.latest_message?.sender)}`);
        }
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

// ── STATE ────────────────────────────────────────────────────────────────
const DEF = () => ({
  botEnabled: false,
  convMeta: {},   // convId -> { stage, introAt, turns, lastText, lastReply, done, lastSukiiReplyAt, userLastMsgAt, paymentConfirmedAt, membershipAt }
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
  const introWait = 0; // disabled — no 3h wait, loop greeting on max turns
  const rules     = cfg.rules || [];
  const greeting = `Sukii. Informan Baby Val.\nChat langsung: membership Tevi.\nVCS: babyval.com`;

  // ── PAYMENT PROOF DETECTION ───────────────────────────────────────────
  function isPaymentProof(msg) {
    if (!msg) return false;
    const t = msg.text || '';
    const LOWER = t.toLowerCase();
    // Check text keywords
    const textKws = ['bukti', 'transfer', 'pembayaran', 'bayar', 'tf', 'receipt', 'lunas', 'sudah transfer', 'udah transfer', 'sdh transfer'];
    const hasTextKw = textKws.some(k => LOWER.includes(k));
    // Check for image attachment (has image_url or image data in the message object)
    const hasImage = !!(msg.images?.length || msg.attachments?.some(a => a.type?.includes('image')) || t.includes('[image]') || t.includes('🖼') || t.includes('foto'));
    // If user mentions payment proof in text AND/OR sends image → payment proof
    return hasTextKw || hasImage;
  }

  // ── SUKII LAST REPLY LOGIC ───────────────────────────────────────────
  // Sukii harus selalu terakhir balas.
  // Skip reply (no reply, no read) if ALL of:
  //   1. NOT a member (handled above)
  //   2. NOT payment (paymentConfirmedAt + 6h not passed yet)
  //   3. NOT user silent >24h
  //   4. Sukii was already the LAST replier (user just following up)
  function shouldSkipReply(meta, msgTime) {
    if (!meta) return false;
    const now = Date.now();
    const sixHours = 6 * 60 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;

    // Rule 4: Sukii was last → user is following up on Sukii's message → skip
    if (meta.sukiiLastReplyAt && meta.sukiiLastReplyAt >= (meta.userLastMsgAt || 0)) {
      logD(`  [skip] Sukii was last replier (sukii=${meta.sukiiLastReplyAt} >= user=${meta.userLastMsgAt})`);
      return true;
    }

    // Rule 3: User silent >24h → OK to reply (wake them up)
    const userAge = (meta.userLastMsgAt || msgTime) ? now - (meta.userLastMsgAt || msgTime) : 0;
    if (userAge > oneDay) {
      logD(`  [allow] User silent >24h (${Math.round(userAge/3600000)}h) — will reply`);
      return false;
    }

    // Rule 2: Payment delay (6h)
    if (meta.paymentConfirmedAt && now - meta.paymentConfirmedAt < sixHours) {
      const remaining = Math.round((sixHours - (now - meta.paymentConfirmedAt)) / 3600000);
      logD(`  [skip] Payment confirmed, ${remaining}h remaining before reply window`);
      return true;
    }

    return false;
  }

  // ── CHECK TRACKED CONVS (after greeting sent, conv drops from unread list) ──
  const tracked = Object.entries(state.convMeta)
    .filter(([id, m]) => !m.done && (m.stage === 'intro_sent' || m.stage === 'cs'))
    .map(([id, m]) => ({ convId: id, ...m }));

  for (const tc of tracked) {
    const { convId, stage, lastText } = tc;
    // Skip if already in this poll's unread convs
    if (convs.find(c => c.id === convId)) continue;

    const messages = await getMessages(convId);
    if (!messages || messages.length === 0) continue;

    const latest = messages[messages.length - 1];
    const latestText = latest?.text || '';
    const latestSenderUid = latest?.sender?.uid || '';
    const latestTime = latest?.created_at ? Number(latest.created_at) * 1000 : Date.now();

    if (latestText === lastText || !latestText) continue;

    if (latestSenderUid === MY_UID) {
      state.convMeta[convId] = { ...state.convMeta[convId], sukiiLastReplyAt: latestTime };
      continue;
    }

    // New user message in tracked conv
    log(`  [tracked @${tc.slug || convId}] user replied: "${latestText.substring(0,30)}"`);
    const slug = tc.slug || convId;
    const newMeta = { ...state.convMeta[convId], userLastMsgAt: latestTime, lastText: latestText };
    state.convMeta[convId] = newMeta;

    if (shouldSkipReply(newMeta, latestTime)) { log(`  @${slug} [skip] Sukii was last replier`); continue; }

    // User replied → go to CS mode immediately
    const rule = findReply(latestText, rules);
    let replyText = rule ? fmtReply(rule.reply, slug) : fmtReply(rules.find(r => r.type === 'fallback')?.reply || '', slug);
    replyText = await aiEnrich(replyText, latestText);
    signalTyping(replyText, slug);
    const sent = await domSend(replyText, slug);
    clearOverlay();
    if (sent) {
      state.convMeta[convId] = { ...newMeta, stage: 'cs', turns: 1, lastReply: replyText, sukiiLastReplyAt: Date.now() };
      replied++;
    }
  }

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

    // Message timestamp (fallback to now)
    let msgTime = Date.now();
    if (msg?.created_at) {
      const ts = Number(msg.created_at) * 1000;
      if (ts > 1700000000000) msgTime = ts;
    }

    processed++;

    // ── MEMBER: never touch ─────────────────────────────────────────────
    if (isSub) {
      if (stage !== 'member') { state.convMeta[convId] = { ...meta, stage: 'member', done: true, membershipAt: Date.now() }; }
      logD(`  @${slug} [member] skipped`);
      ignored++;
      continue;
    }

    // ── OWN MESSAGE ────────────────────────────────────────────────────
    if (senderUid === MY_UID) {
      // Sukii just replied → update timestamp
      if (text && meta.lastReply === text) {
        state.convMeta[convId] = { ...meta, sukiiLastReplyAt: msgTime };
        // Update overlay: Sukii typing done
        clearOverlay();
      }
      ignored++;
      continue;
    }

    // ── DONE: stop replying ────────────────────────────────────────────
    if (meta.done) {
      logD(`  @${slug} [done] ignored`);
      ignored++;
      continue;
    }

    // ── STAGE: intro_sent ─────────────────────────────────────────────
    if (stage === 'intro_sent') {
      // Payment proof in intro_sent → silent end
      if (text && isPaymentProof(msg)) {
        log(`  @${slug} [intro→done] payment proof — silent end`);
        state.convMeta[convId] = { ...meta, done: true, lastText: text, paymentConfirmedAt: Date.now() };
        ignored++;
        continue;
      }

      if (text && text !== meta.lastText) {
        // User replied → go to CS mode immediately
        log(`  @${slug} [intro→CS] replied: "${text.substring(0,30)}"`);
        const rule = findReply(text, rules);
        let replyText = rule ? fmtReply(rule.reply, slug) : fmtReply(rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
        replyText = await aiEnrich(replyText, text);
        signalTyping(replyText, slug);
        const sent = await domSend(replyText, slug);
        clearOverlay();
        if (sent) {
          state.convMeta[convId] = {
            ...meta,
            slug,
            stage: 'cs',
            turns: 1,
            lastText: text,
            lastReply: replyText,
            sukiiLastReplyAt: Date.now(),
            userLastMsgAt: msgTime,
          };
          replied++;
        } else { ignored++; }
      } else {
        logD(`  @${slug} [intro_sent] waiting for reply...`);
        ignored++;
      }
      continue;
    }

    // ── STAGE: cs (CS conversation) ────────────────────────────────────
    if (stage === 'cs') {
      // Payment proof → silent end
      if (text && isPaymentProof(msg)) {
        log(`  @${slug} [CS→done] payment proof — silent end`);
        state.convMeta[convId] = { ...meta, done: true, lastText: text, paymentConfirmedAt: Date.now() };
        ignored++;
        continue;
      }

      if (text && text !== meta.lastText) {
        // New message from user — update user timestamp
        const newMeta = { ...meta, userLastMsgAt: msgTime, lastText: text };
        state.convMeta[convId] = newMeta;

        // Check Sukii-last-replier rule
        if (shouldSkipReply(newMeta, msgTime)) {
          log(`  @${slug} [CS→skip] Sukii was last replier — no reply`);
          // Don't update sukiiLastReplyAt, don't reply
          ignored++;
          continue;
        }

        // Count turn
        const newTurns = (meta.turns || 0) + 1;
        log(`  @${slug} [CS turn ${newTurns}/${maxTurns}] "${text.substring(0,30)}"`);

        if (newTurns > maxTurns) {
          // Max turns → LOOP back to greeting
          log(`  @${slug} [CS→intro] max turns — looping greeting`);
          const sent = await domSend(greeting, slug);
          if (sent) {
            state.convMeta[convId] = {
              ...newMeta,
              stage: 'intro_sent',
              introAt: Date.now(),
              turns: 0,
              lastReply: greeting,
              sukiiLastReplyAt: Date.now(),
            };
            replied++;
          } else { ignored++; }
          continue;
        }

        // Find and send reply
        const rule = findReply(text, rules);
        let replyText = rule ? fmtReply(rule.reply, slug) : fmtReply(rules.find(r => r.type === 'fallback')?.reply || 'Maaf ya...', slug);
        replyText = await aiEnrich(replyText, text);
        signalTyping(replyText, slug);
        const sent = await domSend(replyText, slug);
        clearOverlay();

        if (sent) {
          state.convMeta[convId] = {
            ...newMeta,
            turns: newTurns,
            lastReply: replyText,
            sukiiLastReplyAt: Date.now(),
          };
          replied++;
        } else { ignored++; }
      } else {
        // Same message (no new), check idle
        const idleElapsed = Date.now() - (meta.lastActivityAt || meta.sukiiLastReplyAt || Date.now());
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
    signalNewMessage(`Hai @${slug}!`, slug);
    const sent = await domSend(greeting, slug);
    if (sent) {
      state.convMeta[convId] = {
        slug, stage: 'intro_sent', introAt: Date.now(),
        senderUid, lastText: text, turns: 0,
        sukiiLastReplyAt: Date.now(),
        userLastMsgAt: msgTime,
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
  await setOverlay({ pollTime: Date.now() });
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

// ── AUTO-RELOAD TRIGGER (for auto-reloader.js) ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, send) => {
  if (msg.type === '__TEVI_RELOAD__') {
    log('[RELOAD] __TEVI_RELOAD__ received — reloading extension...');
    // Force service worker to terminate and restart
    chrome.runtime.reload();
    send({ ok: true });
    return true;
  }
});

// ── STARTUP ───────────────────────────────────────────────────────────────
(async () => {
  log('[SW] Tevi CS Bot v0.6.2 — no 3h wait, loop greeting on max turns, Sukii-last-reply');
  await loadToken();
  if (await isEnabled()) {
    chrome.alarms.create(ALARM, { periodInMinutes: POLL_MIN, delayInMinutes: 0.5 });
    log('[SW] Was enabled — poll scheduled');
    setTimeout(async () => { if (await isEnabled()) await poll(); }, 2000);
  }
})();
