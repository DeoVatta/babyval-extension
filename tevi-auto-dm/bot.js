/**
 * BOT — Tevi Auto-DM Bot v1.0.1
 * Permanent Playwright browser + Direct API send + AI + Full conversation flow
 */
const api = require('./api');
const state = require('./state');
const cfg = require('./config');

const LOG_FILE = cfg.LOG_PATH;

function log(msg, ...args) {
  const ts = new Date().toISOString();
  const formatted = args.length
    ? `[${ts}] [BOT] ${msg.replace(/%s/g, () => String(args.shift()))}`
    : `[${ts}] [BOT] ${msg}`;
  console.log(formatted);
  try { require('fs').appendFileSync(LOG_FILE, formatted + '\n'); } catch {}
}

// ── ACTIVE HOURS ─────────────────────────────────────────────────────────────
function isWithinActiveHours() {
  const hour = new Date().getUTCHours();
  if (cfg.ACTIVE_HOURS_START < cfg.ACTIVE_HOURS_END) {
    return hour >= cfg.ACTIVE_HOURS_START && hour < cfg.ACTIVE_HOURS_END;
  }
  return hour >= cfg.ACTIVE_HOURS_START || hour < cfg.ACTIVE_HOURS_END;
}

// ── PERSONA: SUKII ────────────────────────────────────────────────────────────
// Sukii adalah AI Assistant yang friendly, helpful, tapi straight-to-the-point.
// Tone: casual Indonesian dengan emoji. Tidak terlalu formal, tidak terlalu kaku.
// Tujuannya: qualify lead → VCS/membership upsell → close payment.
const PERSONA = {
  name: 'Sukii',
  role: 'AI Assistant Baby Val',
  tagline: 'Kontak pertama antara kamu dan Baby Val 💕',
  greeting: {
    first: `Hai! Aku Sukii, AI Assistant-nya Baby Val 💕

Akhir-akhir ini aku lagi sering ditanya soal VCS dan membership, jadi aku here untuk bantu kalian yang serius!

**VCS (Video Call)**
Baby Val tersedia untuk VCS via Private Room Tevi. Tapi karena banyak yang cancel di tengah jalan, sekarang prosesnya lewat web biar jelas:

1. babyval.com → Video Call
2. Pilih durasi
3. Bayar (Dana / OVO / Transfer)
4. Kirim bukti tf ke dm ini

**Membership**
Benefit: masuk live gratis, konten terbuka, chat kapanpun. Bisa start dari Tevi langsung — tevi.com/@cutieval

Yang mau lanjut, kabari aja ya!`,
  },
};

// ── REPLY ENGINE ──────────────────────────────────────────────────────────────

/**
 * buildGreeting — slot 1. Complete welcome message with all info.
 * Tidak pakai AI, langsung fixed template (karena AI terlalu generic).
 */
function buildGreeting() {
  return PERSONA.greeting.first;
}

/**
 * buildFallback — keyword-based reply untuk slot 2-4.
 * Menggunakan conversation context untuk decide response depth.
 */
function buildFallback(messages, slot, replyType) {
  const last = (messages[messages.length - 1]?.text || '').toLowerCase();
  const hasEmoji = /[\U0001F300-\U0001F9FF]/.test(last);
  const msgCount = messages.length;

  // ── TOPIC: KONTEN/PORN
  if (last.match(/foto|video|konten|porn|sexy|bugil|xxx|ngentot|coli|g写道?|memek/i)) {
    return 'Konten untuk member. Buka profile Baby Val → Join Membership ya! 💕';
  }

  // ── TOPIC: VCS REQUEST
  if (last.match(/vcs|videocall|video call|private room|priv\s*room/i)) {
    if (slot === 2) {
      return `VCS tersedia! 💕 Prosesnya gampang:

babyval.com → Video Call → Pilih Durasi → Bayar → Kirim bukti tf ke dm ini

Boleh tanya dulu, prefer hari & jam apa?`;
    }
    return `VCS via Private Room Tevi ya. babyval.com → Video Call → Durasi → Bayar → Kirim bukti tf.`;
  }

  // ── TOPIC: PAYMENT
  if (last.match(/payment|transfer|bayar|order|bayarnya|dana|ovo|gcash|payment|janji|dp/i)) {
    if (slot === 2) {
      return `Ready untuk VCS 💕

babyval.com → Video Call
Durasi ada 15 / 30 / 60 menit
Bayarnya: Dana / OVO / Transfer

Kirim bukti tf ke dm ini, aku bantu arrange next step.`;
    }
    return `Payment via babyval.com. Dana / OVO / Transfer. babyval.com → Video Call → Bayar.`;
  }

  // ── TOPIC: MEMBERSHIP / JOIN
  if (last.match(/member|membership|join|benefit|langganan/i)) {
    return `Membership Tevi benefit-nya lengkap 💕

✓ Masuk live room gratis
✓ Konten terbuka semua
✓ Chat kapanpun sama Baby Val

Buka tevi.com/@cutieval → Join Membership. Gampang!`;
  }

  // ── TOPIC: INFO PRIBADI (TIDAK BOLEH)
  if (last.match(/alamat|nomor hp|no hp|wa|whatsapp|line|telegram|no\.?\s*hp|nomor\s*(hp|wa|aktif)|umur|usia/i)) {
    return 'Informasi pribadi tidak diberikan ya 🙏 Tapi VCS bisa arrange — babyval.com aja ya!';
  }

  // ── TOPIC: KETEMU OFFLINE
  if (last.match(/ketemu|offline|bertemu|ngumpul|jumpa|bo\b|book|kondangan/i)) {
    if (slot === 2) {
      return 'Offline nggak tersedia ya. Tapi VCS bisa arrange — biar keliatan langsung. babyval.com aja dulu? 💕';
    }
    return 'Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar? 😅';
  }

  // ── TOPIC: MASKER
  if (last.match(/masker|topeng|half\s*mask/i)) {
    return 'Boleh open masker 💕 Tambah 350k dari harga VCS biasa ya.';
  }

  // ── TOPIC: FULL OPEN
  if (last.match(/full open|buka semua|open\s*full/i)) {
    return 'Open semua kecuali masker. Buka masker tambah 350k ya 💕';
  }

  // ── TOPIC: TIP / DONASI
  if (last.match(/tip|donasi|ganknow|send\s*money/i)) {
    return 'Makasih! Bisa lewat ganknow: ganknow.com/babyval/tip 💕';
  }

  // ── TOPIC: BOT / SUKII
  if (last.match(/bot|sukii|siapa kamu|apa kamu|kamu\s*(orang|beneran|tuhan|cewek|bp)|kamuis/i)) {
    return 'Aku Sukii, AI Assistant-nya Baby Val 💕 Aku handle dm kalian di sini. Ada yang bisa aku bantu?';
  }

  // ── TOPIC: CARA BAYAR / VCS
  if (last.match(/cara\s*vcs|cara\s*bayar|cara\s*payment|cara\s*join/i)) {
    return 'babyval.com → Video Call → Pilih Durasi → Bayar (Dana/OVO/Transfer) → Kirim bukti tf ke dm 💕';
  }

  // ── TOPIC: THX / TERIMA KASIH
  if (last.match(/terima kasih|thanks|makasih|thx|tq|sipp|sip|ok thanks|okeh/i)) {
    if (slot === 2) {
      return 'Sama-sama! 💕 Kalau udah siap VCS atau join membership, kabari aku ya!';
    }
    return 'Sukii here 💕 Ada yang mau ditanya lagi?';
  }

  // ── TOPIC: HARGA / DURASI
  if (last.match(/harga|berapa|durasi|durasi\s*berapa|rate|i[nf]fo\s*harga|cost|fee/i)) {
    return `Durasi VCS:
• 15 menit
• 30 menit
• 60 menit

Biar aku bisa kasih harga yang pas, chat aja via dm ya 💕`;
  }

  // ── TOPIC: READY / SERIUS
  if (last.match(/ready|serius|sip|oke\s*(oke|sip)|ya\s*(iya|ya\s*bener)|lets?\s*go|gaskeun/i)) {
    if (slot >= 3) {
      return `Sip! babyval.com → Video Call → Durasi → Bayar → Kirim bukti tf ke dm ini. Aku arrange dari sana 💕`;
    }
    return 'Sipp! 💕 Langsung aja ke babyval.com → Video Call ya!';
  }

  // ── TOPIC: STALKING / KENALAN
  if (last.match(/stalking|stalk|kenal|tau|guesta/i)) {
    return 'Hehe, kenalan boleh 💕 Aku Sukii, AI-nya Baby Val. Ada yang mau ditanya?';
  }

  // ── TOPIC: EMOJI ONLY / HI / SALAM
  if (hasEmoji && last.length < 20) {
    return 'Hai! 💕 Aku Sukii. Mau tanya soal VCS atau membership? Langsung aja ya!';
  }

  if (last.match(/^hai$|^hi$|^halo$|^hello$|^hey$/i) || last.length < 5) {
    return 'Hai! 💕 Aku Sukii, AI-nya Baby Val. Ada yang bisa aku bantu?';
  }

  // ── TOPIC: SIBUK / OFFLINE STATUS
  if (last.match(/sibuk|offline|gabisa|busy|nanti|sometime/i)) {
    return 'Sipp, kabari aja kalau udah siap 💕 babyval.com buat arrange VCS ya!';
  }

  // ── DEFAULT — casual conversation
  if (slot === 2) {
    return 'Hmm, mau tanya soal VCS atau membership? Aku bisa bantu jelasin 💕 Atau langsung ke babyval.com aja ya!';
  }
  return 'Chat langsung sama Baby Val: membership Tevi dulu ya! 💕 tevi.com/@cutieval';
}

// ── AI REPLY ─────────────────────────────────────────────────────────────────
/**
 * generateReply — builds reply text.
 *
 * CRITICAL: greeting (slot 1) is ALWAYS the fixed template below.
 * AI is NEVER used for slot 1 — template is intentional.
 *
 * Slot 2-4 → AI if key set, else fallback keyword template.
 */
async function generateReply(slug, userMessages, slot, replyType) {
  // ── GREETING: ALWAYS fixed template. NEVER touch. ──
  if (replyType === 'greeting') {
    return buildGreeting();
  }

  if (!cfg.AI_KEY) {
    log('[EDGE] No AI key — using fallback');
    return buildFallback(userMessages, slot, replyType);
  }

  try {
    const res = await fetch(cfg.EDGE_FUNC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.AI_KEY}`,
      },
      body: JSON.stringify({ username: slug, userMessages, slot, replyType }),
    });
    if (!res.ok) {
      log('[EDGE] Status=%s — falling back', res.status);
      return buildFallback(userMessages, slot, replyType);
    }
    const data = await res.json();
    log('[EDGE] Reply @%s: %s...', slug, (data.reply || '').substring(0, 40));
    return data.reply || buildFallback(userMessages, slot, replyType);
  } catch (e) {
    log('[EDGE] Error: %s — falling back', e.message);
    return buildFallback(userMessages, slot, replyType);
  }
}

// ── SLOT DECISION ─────────────────────────────────────────────────────────────
/**
 * decideSlot — based on conversation state.
 *
 * Slot increments AFTER confirmed sent (not before).
 * If last reply was > 3 hours ago → reset to greeting.
 *
 * Flow:
 *   conv baru / last reply > 3h ago → slot 1 (greeting, template only)
 *   slot 1 sent → slot 2 (warm reply)
 *   slot 2 sent → slot 3 (follow-up, push closer)
 *   slot 3 sent → slot 4 (closing, direct CTA)
 *   slot 4 sent → slot 1 (greeting, cooldown reset)
 */
async function decideSlot(slug) {
  const { slot } = state.getSlotInfo(slug);
  const needsReset = state.shouldResetSlot(slug);

  if (slot === 0 || needsReset) {
    log('[SLOT] @%s slot=%s needsReset=%s → greeting', slug, slot, needsReset);
    return { type: 'greeting', slot: 1 };
  }

  if (slot >= 4) {
    // Slot 4 full — reset to greeting
    log('[SLOT] @%s slot=%s (full) → greeting', slug, slot);
    return { type: 'greeting', slot: 1 };
  }

  const newSlot = slot + 1;
  log('[SLOT] @%s slot=%s → %s', slug, slot, newSlot);
  return { type: 'reply', slot: newSlot };
}

// ── FILTER CONVS ─────────────────────────────────────────────────────────────
function filterConvs(convs, botState) {
  const now = Date.now();
  const result = [];

  for (const conv of convs) {
    const slug = conv.channel_slug || conv.recipient?.channel_slug || '?';
    const lastSender = String(conv.latest_message?.sender?.alias || '');
    const unread = conv.stats?.unread_messages || 0;
    const createdAt = conv.latest_message?.created_at;
    const isSubscriber = conv.recipient?.is_my_subscriber;

    if (slug.toLowerCase() === cfg.MY_SLUG.toLowerCase()) {
      log('[FILTER] skip @%s reason=my_own', slug); continue;
    }
    if (lastSender === cfg.MY_UID) {
      log('[FILTER] skip @%s reason=i_sent_last', slug); continue;
    }
    if (unread === 0) {
      log('[FILTER] skip @%s reason=no_unread', slug); continue;
    }
    if (createdAt && (now - createdAt) > 24 * 60 * 60 * 1000) {
      log('[FILTER] skip @%s reason=older_than_24h', slug); continue;
    }
    if (isSubscriber) {
      log('[FILTER] skip @%s reason=is_subscriber', slug); continue;
    }
    if (state.wasRecentlyReplied(conv.id, botState)) {
      log('[FILTER] skip @%s reason=done_recently', slug); continue;
    }

    log('[FILTER] PASS @%s unread=%s sender=%s', slug, unread, lastSender);
    result.push(conv);
  }

  return result;
}

// ── EXTRACT USER MESSAGES ────────────────────────────────────────────────────
function extractUserMessages(messages) {
  return messages
    .filter(m => {
      if (!m.text) return false;
      const senderAlias = String(m.sender?.alias || '');
      return senderAlias !== cfg.MY_UID;
    })
    .slice(-cfg.MAX_MSGS)
    .map(m => ({
      text: m.text || '',
      hasImage: !!(m.images && m.images.length > 0),
      createdAt: m.created_at,
    }));
}

// ── PROCESS ONE CONVERSATION ─────────────────────────────────────────────────
async function processConv(conv) {
  const convId = conv.id;
  const slug = conv.channel_slug || conv.recipient?.channel_slug || 'unknown';
  const unread = conv.stats?.unread_messages || 0;

  log('[PROC] Processing conv=%s @%s unread=%s', convId.substring(0, 8), slug, unread);

  const messages = await api.getMessages(convId);
  if (!messages || messages.length === 0) {
    log('[PROC] @%s no messages fetched', slug);
    return false;
  }

  const userMsgs = extractUserMessages(messages);
  if (userMsgs.length === 0) {
    log('[PROC] @%s no user messages — mark read', slug);
    await api.markRead(convId);
    return true;
  }

  const hasImage = userMsgs.some(m => m.hasImage);
  const { type, slot } = await decideSlot(slug);

  log('[PROC] @%s → slot=%s type=%s msgs=%s img=%s', slug, slot, type, userMsgs.length, hasImage);

  const reply = await generateReply(slug, userMsgs, slot, type);
  log('[PROC] @%s reply: %s...', slug, reply.substring(0, 60));

  const sent = await api.sendMessage(convId, reply);

  if (sent.ok) {
    // ✅ CONFIRMED SENT — only now commit slot + mark replied
    state.commitSlot(slug);
    state.markReplied(convId);
    await api.markRead(convId);
    log('[PROC] @%s sent=true ✅ slot=%s', slug, slot);
    return true;
  } else {
    log('[PROC] @%s sent=false status=%s', slug, sent.status);
    // Slot NOT incremented — same message on next scan
    return false;
  }
}

// ── POLL ─────────────────────────────────────────────────────────────────────
async function poll() {
  log('[POLL] Fetching conversations...');

  const convs = await api.getConversations('ALL', 20);
  if (!convs) {
    log('[POLL] Failed to get conversations');
    return { processed: 0, success: 0, fail: 0 };
  }

  log('[POLL] Got %d conversations total', convs.length);

  const botState = state.loadState();
  const filtered = filterConvs(convs, botState);
  log('[POLL] %d to process after filter', filtered.length);

  if (filtered.length === 0) return { processed: 0, success: 0, fail: 0 };

  let success = 0, fail = 0;
  for (const conv of filtered) {
    try {
      const ok = await processConv(conv);
      if (ok) success++; else fail++;
      await new Promise(r => setTimeout(r, cfg.SEND_DELAY_MS));
    } catch (e) {
      log('[POLL] processConv error: %s', e.message);
      fail++;
    }
  }

  const st = state.loadState();
  st.lastRun = new Date().toISOString();
  state.saveState(st);

  log('[POLL] Done: success=%s fail=%s of %d', success, fail, filtered.length);
  return { processed: filtered.length, success, fail };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry');

async function main() {
  log('==========================================');
  log('TEVI AUTO-DM v1.0.1 %s', DRY_RUN ? '(DRY RUN)' : '(LIVE)');
  log('Active hours: 17:00-05:00 WIB | UTC: %s-%s', cfg.ACTIVE_HOURS_START, cfg.ACTIVE_HOURS_END);
  log('Current UTC hour: %s | In active hours: %s', new Date().getUTCHours(), isWithinActiveHours());
  log('==========================================');

  const ok = await api.ensureBrowser();
  if (!ok) { log('[FATAL] Browser failed'); process.exit(1); }

  const loginOk = await api.login();
  if (!loginOk) { log('[FATAL] Login failed'); await api.shutdown(); process.exit(1); }

  const tokenOk = await api.captureToken();
  if (!tokenOk) { log('[FATAL] Token capture failed'); await api.shutdown(); process.exit(1); }

  let pollCount = 0;
  while (true) {
    pollCount++;
    const utcHour = new Date().getUTCHours();
    const inHours = isWithinActiveHours();

    log('\n[LOOP] Poll #%d UTC=%s inHours=%s — %s', pollCount, utcHour, inHours, new Date().toISOString());

    if (!api.isConnected()) {
      log('[WARN] Browser disconnected — reconnecting...');
      const reOk = await api.ensureBrowser();
      if (!reOk) { log('[FATAL] Cannot reconnect'); process.exit(1); }
    }

    if (inHours) {
      await poll();
    } else {
      log('[LOOP] Outside active hours — skipping');
    }

    await new Promise(r => setTimeout(r, cfg.POLL_INTERVAL_MS));
  }
}

process.on('SIGINT', async () => {
  log('[SHUTDOWN] Stopping...');
  await api.shutdown();
  process.exit(0);
});

main().catch(e => {
  log('[FATAL] %s', e.message);
  api.shutdown().catch(() => {});
  process.exit(1);
});
