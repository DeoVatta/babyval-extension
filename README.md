# babyval-extension — Tevi CS Bot

Edge/Chrome MV3 extension untuk otomatisasi Tevi CS (Customer Service) bot @cutieval (UID=392388705).

## Struktur Direktori

```
babyval-extension/
├── README.md
├── CLAUDE.md
├── auditor-prompt.md
├── tester-prompt.md
├── session-sync.md
├── supabase/                       # Supabase backend (Edge Functions + migrations)
├── tevi-cs/                        # Chrome MV3 Extension (Service Worker)
└── tevi-auto-dm/                   # Playwright permanent browser bot
    ├── bot.js       # Main loop — scan, filter, reply
    ├── api.js       # Playwright browser + API calls
    ├── config.js    # Credentials, timing, active hours
    ├── state.js     # JSON state management
    └── README.md
```

> Extension lain (jika ada) akan di-fork dari `babyval-extension/` yang sama, bukan di dalam `tevi-cs/`.

## Flow v0.9.3

```
TOGGLE ON
  ↓
SCAN (20s alarm / tab switch)
  → Navigate to messages page
  → SCAN_CONVS: find convs with no ✓/✓✓ icon
  → Filter: skip membership, skip image-cooldown (6h), skip self
  ↓
PROCESS ONE CONV
  → Navigate to @slug/messages
  → GET_MSGS: read 4 latest USER messages
  → SLOT DECISION: greeting (slot=1) or reply (slot 2-4)
  → CALL Supabase Edge Function:
      → Check cs_users for membership/payment history
      → Log user messages to cs_chat_logs
      → Call Olagon AI (with psychology context)
      → Log Sukii's reply to cs_chat_logs
      → Update user last_chat_at
  → Send reply via intercepted Tevi API
  ↓
Return to messages, idle 20s → repeat
```

## AI System — Olagon Gateway

**Endpoint:** `https://gateway.olagon.site/anthropic`
**Edge Function:** `https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger`
**Model:** `claude-sonnet-4-6`
**AI Key:** `<AI_KEY>` (simpan di popup Keys tab)

## Supabase Schema

```sql
cs_users        — username, membership_status, payment_count, first_seen, last_chat
cs_chat_logs    — username, sender (user/sukii), message, slot, reply_type, tokens
cs_payment_proofs — username, image_url, amount, verified
```

## AI Training Rules (Sukii v0.9.3)

### BOLEH DIJAWAB ✅
| Topic | Jawaban |
|---|---|
| Cara membership | Buka profile Baby Val → Join Membership |
| Cara VCS | babyval.com → Video Call → Durasi → Bayar |
| Cara bayar | babyval.com → VCS → Durasi → Bayar (Dana/OVO/transfer) |
| Payment Dana/OVO | babyval.com → VCS → Bayar. Dana/OVO/transfer tersedia. |
| VCS via apa? | Private Room Tevi. Ber-2 aja. |
| Open masker | Boleh open masker. Tambah 350k. |
| Full open | Buka semua kecuali masker. Buka masker tambah 350k. |
| Benefit membership | Masuk live gratis, konten terbuka, chat kapanpun |
| Mau kasih tip | ganknow.com/babyval/tip |
| Ngobrol umum | Bebas, selama tidak tidak pantas |

### TIDAK BOLEH DIJAWAB ❌
| Topic | Jawaban |
|---|---|
| Alamat/no HP/WA | "Informasi pribadi tidak diberikan." |
| Ketemu offline | "Cuma bisa VCS. Offline tidak tersedia." |
| Kirim konten langsung | "Konten untuk member." |
| Chat tidak pantas | "Kalau mau chat sama Baby Val, membership dulu ya." |
| Info member lain | Di luar layanan |

### BATASAN
- Tidak kasih nomor pribadi, alamat, email, lokasi, umur
- Tidak janji bisa ketemu offline
- Tidak kasih link selain babyval.com, tevi.com/@cutieval, ganknow.com/babyval/tip

### PSIKOLOGI — User Belum Pernah Bayar
Jika user tanya offline/BO/ketemu tapi belum pernah payment:
→ "Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?"

Tujuannya: Tekanan halus agar user payment tanpa bilang "tidak bisa ketemu".

## Slot System (v0.9.4)

| Slot | Type | AI Context |
|------|------|------------|
| 1 | Greeting | Always greeting |
| 2 | Reply | 4 user msgs + user context |
| 3 | Reply | 4 user msgs + user context |
| 4 | Reply | 4 user msgs + user context |
| 5+ | Greeting | Resets after slot 4 |

## Psychology Context (dari Supabase cs_users)

Edge function injects context sebelum AI generate reply:
- `[USER ADALAH MEMBER]` — boleh lebih friendly
- `[USER SUDAH PERNAH BAYAR]` — telah kirim foto/proof
- `[USER BELUM PERNAH BAYAR — PSIKOLOGI HARUS DIAKTIFKAN]` — trigger sales pressure

## Setup

### 1. Start Log Server
```bash
cd C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
node log-server.js
```

### 2. Load Extension
```
edge://extensions/ → Developer mode → Load unpacked
Pilih: C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
```

### 3. Setup AI Key
Extension popup → tab Keys → Save & Apply (AI key sudah terisi)

### 4. Toggle ON
Extension popup → toggle ON

## Active Hours

Aktif: **17:00–05:00 WIB** (UTC 10:00–22:00). Di luar jam aktif, bot scan tapi skip semua reply.

## Changelog

### v0.9.23 — 2026-06-26
- **FEAT: Active Hours Filter** — bot hanya reply jam 17:00–05:00 WIB. Scan tetap jalan tapi skip semua reply di luar jam aktif. Log: `[SCAN] Outside active hours (UTC N) — skipping`

### v0.9.22 — 2026-06-26
- **FEAT: 24h Filter** — skip convs where `latest_message.created_at > 24h` old. Log: `reason=older_than_24h`
- **FEAT: Heartbeat + Stale Detection** — alarm every 24s, marks stale if no scan for 60s
- **FEAT: MarkRead Fix** — tries `/read` then `/rpc/mark_conversation_read`, no trailing slash
- **IMPROVE: syncBotStatus** — writes to chrome.storage.local only (no Supabase dependency)
- **IMPROVE: convMeta cleanup** — removes entries older than 48h on init
- **FIX: aiKey storage** — `generateReply()` now correctly reads `tevi_cs_secrets.aiKey` (was always undefined → always fallback)
- **FIX: apiSendPattern storage** — correctly reads from storage without wrong destructuring
- **FIX: GET_STATUS** — now returns `hasToken` field so popup always gets full status
- **FIX: Greeting template** — uses exact template text, not AI-generated
- **FIX: Slug extraction** — from anchor href `tevi.com/@slug`, NOT from message text
- **FIX: CS version sync** — content-script.js bumped to v0.9.3
- **IMPROVE: Slot tracking** — records `lastSlot` on every attempt for better debugging
- **IMPROVE: Fallback greeting** — time-aware template for natural feel when edge function fails

### v0.9.4 — 2026-06-26
- **FIX: User upsert** — edge function now INSERT new users + UPDATE last_chat_at (was only SELECT)
- **FIX: payment_count increment** — image messages now increment payment_count in cs_users
- **FIX: first_seen_at** — new users now get first_seen_at set on first contact
- **SECURITY: API key validation** — edge function now validates Bearer token before processing
- **SECURITY: Rate limit** — 20 calls/minute per IP (prevents abuse)
- **SECURITY: Username sanitization** — only alphanumeric + underscore, max 50 chars
- **SECURITY: Message truncation** — messages truncated to 1000 chars to prevent large payloads

### v0.9.3 — 2026-06-26
- **Supabase Edge Function**: `cs-bot-logger` handles all AI calls + Supabase logging
- **Full AI Training Rules**: 20+ topics covered (membership, VCS, payment, masker, full open, private room, tips)
- **Psychology Triggers**: user tanpa payment history → "Coba deh VCS dulu..." pressure
- **User Context in AI**: edge function injects member/payment status before AI call
- **cs_users table**: tracks username, membership_status, payment_count, last_chat_at
- **cs_chat_logs table**: logs every user message + Sukii reply with slot + reply_type + tokens
- **cs_payment_proofs table**: tracks payment proof submissions
- **Fallback improved**: 20 keyword rules
- **Directory restructure**: all files under `tevi-cs/` for clean extension management

### v0.9.2 — 2026-06-26
- **Olagon Gateway**: AI calls via `https://gateway.olagon.site/anthropic`
- **Training Rules**: AI system prompt lengkap dengan BOLEH/TIDAK BOLEH/BATASAN rules

### v0.9.1 — 2026-06-26
- **FIX**: hasRepliedIcon, scanConvs, lastMsgTs, popup↔BG bridge, generateReply fallback, isFromUser, findConvItems, navigateFailCount, membership detection, API body handling
- **FEAT**: chrome.tabs.onActivated, greeting from config, convMeta cleanup

### v0.9.0 — 2026-06-26
- **Complete rewrite**: DOM conv detection, 4-msg context, slot system, image cooldown
