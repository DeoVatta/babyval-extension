# Tevi CS Bot — Sukii Assistant

## Apa Ini

Bot CS (Customer Service) otomatis untuk akun **@cutieval** di Tevi.com.

Bot scan semua DM masuk yang belum dibalas, terus balas pakai AI (persona: "Sukii") dengan topik yang sesuai — membership, VCS, payment, masker, dll. Semua chat logged ke Supabase.

---

## Goals

1. **Automasi balas chat** — 24/7 tanpa perlu manual
2. **AI-powered** — Jawaban dari Olagon AI, persona Sukii (cold, informatif, langsung)
3. **Log semua chat** — Supabase (users, chat_logs, payment_proofs)
4. **Slot system** — Tidak spam. Maksimal 4x balas per user, lalu reset.
5. **Image cooldown** — User kirim gambar → skip 6 jam (asumsi: bukti payment)

---

## AI Rules (Sukii v0.9.7)

### ✅ BOLEH DIJAWAB
| Topik | Jawaban |
|---|---|
| Cara membership | Buka profile Baby Val → Join Membership |
| Cara VCS | babyval.com → Video Call → Durasi → Bayar |
| Cara bayar | babyval.com → VCS → Durasi → Bayar (Dana/OVO/transfer) |
| Payment Dana/OVO | babyval.com → VCS → Bayar. Dana/OVO/transfer tersedia. |
| Open masker | Boleh open masker. Tambah 350k. |
| Full open | Buka semua kecuali masker. Buka masker tambah 350k. |
| VCS via apa? | Private Room Tevi. Ber-2 aja. |
| Benefit membership | Masuk live gratis, konten terbuka, chat kapanpun |
| Mau kasih tip | ganknow.com/babyval/tip |

### ❌ TIDAK BOLEH DIJAWAB
| Topik | Jawaban |
|---|---|
| Alamat/no HP/WA | "Informasi pribadi tidak diberikan." |
| Ketemu offline | "Cuma bisa VCS. Offline tidak tersedia." |
| Kirim konten langsung | "Konten untuk member." |
| Chat tidak pantas | "Kalau mau chat sama Baby Val, membership dulu ya." |

### 🧠 Psikologi — User Belum Pernah Bayar
Kalau user tanya offline/BO/ketemu tapi belum pernah payment:
→ **"Coba deh VCS dulu.. VCS aja belum emang bakal beneran bayar?"**

Tujuannya tekanan halus agar user payment, tanpa bilang "tidak bisa ketemu".

---

## Greeting Template (Static — Tidak AI-generated)

```
Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi

Kalau mau VCS bisa bayar di babyval.com
```

---

## Slot System

| Slot | Type | Keterangan |
|---|---|---|
| 1 | Greeting | Perkenalan Sukii |
| 2 | Reply | Balasan konteks #1 |
| 3 | Reply | Balasan konteks #2 |
| 4 | Reply | Balasan konteks #3 |
| 5+ | Greeting | Reset ke slot 1 |

---

## Status v0.9.8 (2026-06-26) — READY TO TEST

### v0.9.8 Fixes
- **Scan debounce** — `_scanInProgress` lock prevents parallel scans (was causing `[SCAN] failed`)
- **Debug logs** — content script now logs `findConvItems` count + first item class
- **Probe auth** — sends actual AI key in Authorization header
- **api-auto-probe endpoint** — `api-discovery.js` sends directly to both endpoints

### What's New: Fully Automated API Discovery

**不再需要用户手动操作。** Extension自动探测Tevi API。

**`api-auto-probe` Edge Function:**
- Extension启动时自动探测已知API patterns
- 测试所有可能的API host (`wapi.flowstreamx.com`, `api.tevi.com`, dll.)
- 所有发现的endpoint → `tevi_api_endpoints` table
- 所有发现的token → `tevi_auth_tokens` table
- Conversations cache → `tevi_conversations_cache` table

**`api-discovery.js`:**
- 捕获所有 `wapi.flowstreamx.com` API调用
- 发现新endpoint时直接发送到Supabase (持久化)
- 不再只依赖本地存储

**`cs-bot-logger`:**
- 支持 `_type: "api_discovery"` 事件
- 自动存储endpoint到Supabase

### Supabase Tables
| Table | Description |
|---|---|
| `tevi_api_endpoints` | 所有发现的API endpoints |
| `tevi_auth_tokens` | 所有捕获的auth token |
| `tevi_conversations_cache` | Conversations列表缓存 |

### Setup
1. Reload extension
2. 启动log server: `node log-server.js`
3. 检查popup → API tab → 查看发现的endpoints

### Changelog

---

## Struktur Direktori

```
babyval-extension/
├── README.md
├── CLAUDE.md
└── tevi-cs/
    ├── manifest.json           # MV3 v0.9.5
    ├── background.js          # Service Worker — scan, slot, edge function call
    ├── content-script.js      # DOM — SCAN_CONVS, GET_MSGS, INTERCEPT_SEND
    ├── api-discovery.js      # API capture — ALL wapi.flowstreamx calls → Supabase
    ├── log-server.js        # Local HTTP log receiver (port 3131)
    ├── popup/
    │   └── popup.html     # Extension popup UI (Rules/Behavior/Persona/Keys/API tabs)
    ├── icons/
    └── supabase/
        ├── config.toml
        ├── functions/
        │   ├── cs-bot-logger/    # AI + logging + API discovery handler
        │   └── api-auto-probe/    # Auto-probe Tevi API endpoints
        └── migrations/
            ├── 20260606000101_cs_bot_schema.sql      # CS tables
            └── 20260625205315_tevi_api_discovery.sql # API discovery tables
    ├── overlay.js             # Cat overlay (optional)
    ├── interceptor.js         # API capture untuk debugging
    ├── log-server.js         # Local HTTP log receiver (port 3131)
    ├── popup/
    │   └── popup.html        # Extension popup UI
    ├── icons/
    └── supabase/
        ├── config.toml
        ├── functions/
        │   └── cs-bot-logger/ # Edge function — AI + logging
        └── migrations/
            └── 20260606000101_cs_bot_schema.sql

Extension lain (jika ada) di-fork dari babyval-extension/ yang sama.
```

---

## Setup

### 1. Start Log Server
```bash
cd C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
node log-server.js
```

### 2. Load Extension
```
edge://extensions/
→ Developer mode → Load unpacked
→ Pilih: C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs
```

### 3. Set AI Key
Buka popup → tab **Keys** → masukkan AI key → **Save & Apply**

AI key: `<AI_KEY>` (simpan di popup Keys tab)

### 4. Capture API Send Pattern
1. Buka tab Tevi.com/messages
2. Kirim DM manual ke seseorang
3. Buka DevTools (F12) → Console → lihat log `[INTERCEPT] Captured:`
4. Ini akan capture API endpoint untuk kirim pesan tanpa tab

### 5. Toggle ON
Popup → toggle → ON

### 6. Watch Log
```bash
pwsh -Command "Get-Content 'tevi-cs-logs.txt' -Tail 30 -Wait"
```

---

## Supabase Schema

### cs_users
| Column | Type | Description |
|---|---|---|
| username | text PK | Username Tevi |
| membership_status | text | none / active / expired |
| payment_count | int | Jumlah bukti payment |
| first_seen_at | timestamptz | First chat |
| last_chat_at | timestamptz | Last chat |

### cs_chat_logs
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| username | text FK | Referensi cs_users |
| sender | text | user / sukii |
| message | text | Isi pesan |
| has_image | bool | Ada gambar |
| slot | int | Slot 1-4 |
| reply_type | text | greeting / ai / fallback |
| ai_model | text | Model AI |
| tokens_used | int | Token usage |
| created_at | timestamptz | Timestamp |

### cs_payment_proofs
| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto |
| username | text FK | Referensi cs_users |
| image_url | text | URL bukti transfer |
| amount | int | Nominal |
| verified | bool | Sudah diverifikasi |

---

## AI System

- **Gateway:** `https://gateway.olagon.site/anthropic`
- **Edge Function:** `https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger`
- **Model:** `claude-sonnet-4-6`
- **Rate Limit:** 20 calls/min per IP (edge function)
- **Fallback:** Keyword-based kalau AI gagal atau tidak ada key

---

## Changelog

### v0.9.7 — 2026-06-26
- **FEAT: api-auto-probe edge function** — auto-probes common Tevi API patterns at SW init
- **FEAT: Supabase `tevi_api_endpoints` table** — persistent endpoint storage
- **FEAT: Supabase `tevi_auth_tokens` table** — persistent token storage
- **FEAT: Supabase `tevi_conversations_cache` table** — conversations cache
- **FEAT: api-discovery.js → Supabase logging** — discovered endpoints sent directly to Supabase
- **FEAT: cs-bot-logger handles `_type: api_discovery`** — stores endpoints in Supabase

### v0.9.6 — 2026-06-26
- Critical fix: aiKey storage path (was always undefined)
- Critical fix: apiSendPattern storage path
- Critical fix: GET_STATUS hasToken field
- Fix: Greeting pakai template static
- Fix: Slug extraction dari href, bukan teks
- Fix: CS version sync v0.9.3
- Improve: Slot tracking with lastSlot
- Edge function: greeting template fix

### v0.9.4 — 2026-06-26
- Edge function: User upsert (INSERT + UPDATE)
- Edge function: payment_count increment on image
- Edge function: first_seen_at for new users
- Edge function: Auth validation
- Edge function: Rate limit 20/min

### v0.9.3 — 2026-06-26
- Supabase Edge Function untuk AI + logging
- AI training rules lengkap
- Psychology trigger untuk non-payer
- cs_users / cs_chat_logs / cs_payment_proofs tables

### v0.9.2 — 2026-06-26
- Olagon Gateway integration

### v0.9.1 — 2026-06-26
- DOM conv detection, 4-msg context, slot system, image cooldown
