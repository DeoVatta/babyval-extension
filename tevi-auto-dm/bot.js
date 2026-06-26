/**
 * BOT — Tevi Auto-DM Bot v1.0.0
 * Permanent Playwright browser + Direct API send + AI fallback
 *
 * Flow:
 * 1. Launch browser once, login once
 * 2. Capture wapi token from browser context
 * 3. Every poll cycle:
 *    a. GET /get_recent_conversations?filter=ALL
 *    b. Filter: skip own conv, skip my last-sender, skip no_unread, skip >24h, skip subscribers
 *    c. For each conv: GET messages → decide slot → generate AI/template reply
 *    d. POST /send_message via browser context (has cf_clearance cookie)
 *    e. POST /mark_read
 * 4. Sleep 3 min → repeat
 */
const api = require('./api');
const state = require('./state');
const cfg = require('./config');

const LOG_FILE = cfg.LOG_PATH;

function log(msg, ...args) {
  const ts = new Date().toISOString();
  const line = args.length
    ? `[${ts}] [BOT] ${msg.replace(/%s/g, () => String(args.shift()))}\n  args: ${JSON.stringify(args)}`
    : `[${ts}] [BOT] ${msg}`;
  console.log(line);
  try { require('fs').appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ── ACTIVE HOURS ─────────────────────────────────────────────────────────────
function isWithinActiveHours() {
  const hour = new Date().getUTCHours();
  if (cfg.ACTIVE_HOURS_START < cfg.ACTIVE_HOURS_END) {
    return hour >= cfg.ACTIVE_HOURS_START && hour < cfg.ACTIVE_HOURS_END;
  }
  // Spans midnight
  return hour >= cfg.ACTIVE_HOURS_START || hour < cfg.ACTIVE_HOURS_END;
}

// ── FALLBACK REPLY (keyword matching) ────────────────────────────────────────
function buildFallback(messages, slot, replyType) {
  if (replyType === 'greeting') {
    return `Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi

Kalau mau VCS bisa bayar di babyval.com`;
  }
  const last = (messages[messages.length - 1]?.text || '').toLowerCase();
  if (last.match(/foto|video|konten|porn|sexy|bugil|xxx|ngentot|coli/i)) return 'Konten untuk member.';
  if (last.match(/vcs|videocall|video call|private room/i)) return 'VCS via Private Room Tevi. babyval.com → Video Call → Durasi → Bayar.';
  if (last.match(/payment|transfer|bayar|order|bayarnya|dana|ovo/i)) return 'Payment via babyval.com. Dana/OVO/transfer. babyval.com → VCS → Bayar.';
  if (last.match(/member|membership|join|benefit/i)) return 'Benefit: masuk live gratis, konten terbuka, chat kapanpun. tevi.com/@cutieval';
  if (last.match(/alamat|nomor hp|no hp|wa|whatsapp|line|telegram/i)) return 'Informasi pribadi tidak diberikan.';
  if (last.match(/ketemu|offline|bertemu|ngumpul|jumpa|bo/i)) return 'Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?';
  if (last.match(/terima kasih|thanks|makasih|thx|tq/i)) return 'Sukii. Ada yang perlu ditanyakan?';
  if (last.match(/masker|topeng/i)) return 'Boleh open masker. Tambah 350k.';
  if (last.match(/full open|buka semua/i)) return 'Buka semua kecuali masker. Buka masker tambah 350k.';
  if (last.match(/tip|donasi|ganknow/i)) return 'Tip: ganknow.com/babyval/tip';
  if (last.match(/bot|sukii|siapa kamu|apa kamu/i)) return 'Sukii. Informan Baby Val.';
  if (last.match(/cara (membership|member|join)/i)) return 'Buka profile Baby Val → Join Membership';
  if (last.match(/cara vcs|cara (bayar|payment)/i)) return 'babyval.com → Video Call → Durasi → Bayar';
  return 'Chat langsung dengan Baby Val: membership Tevi.';
}

// ── AI REPLY ─────────────────────────────────────────────────────────────────
async function generateReply(slug, userMessages, slot, replyType) {
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

// ── SLOT ─────────────────────────────────────────────────────────────────────
async function decideSlot(slug) {
  const st = state.loadState();
  const userSlot = (st.repliedOnce[`_slot_${slug}`] || 0) + 1;
  const type = userSlot >= 4 ? 'greeting' : 'reply';
  st.repliedOnce[`_slot_${slug}`] = userSlot;
  state.saveState(st);
  return { type, slot: userSlot };
}

// ── FILTER ───────────────────────────────────────────────────────────────────
function filterConvs(convs, botState) {
  const now = Date.now();
  const result = [];

  for (const conv of convs) {
    const slug = conv.channel_slug || conv.recipient?.channel_slug || '?';
    const lastSender = String(conv.latest_message?.sender?.alias || '');
    const unread = conv.stats?.unread_messages || 0;
    const createdAt = conv.latest_message?.created_at;
    const isSubscriber = conv.recipient?.is_my_subscriber;

    // Skip own conv
    if (slug.toLowerCase() === cfg.MY_SLUG.toLowerCase()) {
      log('[FILTER] skip @%s reason=my_own', slug); continue;
    }
    // Skip my last-sender (not incoming DM)
    if (lastSender === cfg.MY_UID) {
      log('[FILTER] skip @%s reason=i_sent_last sender=%s', slug, lastSender); continue;
    }
    // Skip no unread
    if (unread === 0) {
      log('[FILTER] skip @%s reason=no_unread', slug); continue;
    }
    // Skip > 24h old
    if (createdAt && (now - createdAt) > 24 * 60 * 60 * 1000) {
      log('[FILTER] skip @%s reason=older_than_24h createdAt=%s', slug, new Date(createdAt).toISOString()); continue;
    }
    // Skip subscribers
    if (isSubscriber) {
      log('[FILTER] skip @%s reason=is_subscriber', slug); continue;
    }
    // Skip recently replied
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
    .map(m => ({ text: m.text || '', hasImage: !!(m.images && m.images.length > 0) }));
}

// ── PROCESS ONE CONVERSATION ─────────────────────────────────────────────────
async function processConv(conv) {
  const convId = conv.id;
  const slug = conv.channel_slug || conv.recipient?.channel_slug || 'unknown';
  const unread = conv.stats?.unread_messages || 0;

  log('[PROC] Processing conv=%s @%s unread=%s', convId.substring(0, 8), slug, unread);

  // Get full messages
  const messages = await api.getMessages(convId);
  if (!messages || messages.length === 0) {
    log('[PROC] @%s no messages fetched', slug);
    return false;
  }

  const userMsgs = extractUserMessages(messages);
  if (userMsgs.length === 0) {
    log('[PROC] @%s no user messages', slug);
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
    const st = state.loadState();
    state.markReplied(convId, st);
    await api.markRead(convId);
    log('[PROC] @%s sent=true ✅', slug);
    return true;
  } else {
    log('[PROC] @%s sent=false status=%s', slug, sent.status);
    return false;
  }
}

// ── MAIN POLL ────────────────────────────────────────────────────────────────
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
      // Small delay between convs
      await new Promise(r => setTimeout(r, cfg.SEND_DELAY_MS));
    } catch (e) {
      log('[POLL] processConv error @%s: %s', conv.channel_slug || conv.recipient?.channel_slug, e.message);
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
  log('TEVI AUTO-DM v1.0.0 %s', DRY_RUN ? '(DRY RUN)' : '(LIVE)');
  log('Active hours: 17:00-05:00 WIB | UTC: %s-%s', cfg.ACTIVE_HOURS_START, cfg.ACTIVE_HOURS_END);
  log('Current UTC hour: %s | In active hours: %s', new Date().getUTCHours(), isWithinActiveHours());
  log('==========================================');

  // Launch browser
  const ok = await api.ensureBrowser();
  if (!ok) { log('[FATAL] Browser failed'); process.exit(1); }

  // Login
  const loginOk = await api.login();
  if (!loginOk) { log('[FATAL] Login failed'); await api.shutdown(); process.exit(1); }

  // Capture token
  const tokenOk = await api.captureToken();
  if (!tokenOk) { log('[FATAL] Token capture failed'); await api.shutdown(); process.exit(1); }

  // Main loop
  let pollCount = 0;
  while (true) {
    pollCount++;
    const utcHour = new Date().getUTCHours();
    const inHours = isWithinActiveHours();

    log('\n[LOOP] Poll #%d UTC=%s inHours=%s — %s', pollCount, utcHour, inHours, new Date().toISOString());

    // Reconnect if browser disconnected
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
