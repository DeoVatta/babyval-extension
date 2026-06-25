# babyval-extension — Tevi CS Bot

Edge/Chrome MV3 extension untuk otomatisasi Tevi CS (Customer Service) bot @cutieval (UID=392388705).

## Arsitektur

```
tevi-cs/
├── manifest.json      # MV3 manifest v0.7.0
├── background.js      # Service Worker: polling, HMAC, API, state machine, conv queue
├── content-script.js  # DOM automation: PING, typing, send, page-ready detection
├── overlay.js         # Cute cat overlay (sleep/alert/typing animation)
├── popup/popup.html   # Rules editor UI
├── log-server.js      # Local HTTP log receiver
└── icons/
```

## State Machine

```
IDLE (tevi.com/messages)
  ↓ poll detects new conv → add to queue
QUEUE MODE: process ONE conv at a time
  → navigate to DM
  → waitForPageReady (PING until CS responds)
  → type + send + wait 1.5s confirm
  → 8-12s delay before next task
  → loop until queue empty
```

## Flow Bot

```
Pesan masuk → Greeting (intro_sent)
  ↓ user balas (immediate — no 3h wait)
CS mode → reply sesuai keyword rules
  ↓ max turns (3) → loop greeting
  ↓ idle 30 menit → done
  ↓ payment proof detected → silent end
```

**Sukii Must Be Last Replier** — semua pesan harus Sukii terakhir balas, KECUALI:
1. Membership — never touch
2. Payment confirmed — 6 jam delay
3. User diam >24 jam — boleh balas

## Queue Mode (v0.7.0)

```
Poll → discover new convs → add to queue
Process ONE at a time:
  1. Navigate to @slug/messages
  2. waitForPageReady (PING until CS responds, max 20s)
  3. domSendWithConfirm: type → click send → wait 1.5s → confirm
  4. Dynamic delay before next:
     - Greeting sent: 12s
     - Reply sent: 8s
     - Failed/deferred: 15s
     - Ignored: 5s
  5. Release queue → next conv
```
**Problem solved**: v0.6.x — 100 convs processed simultaneously → tab collision → "No tevi tab open"

## Keyword Rules (Cold/Informant Tone)

| Priority | Trigger | Reply |
|---|---|---|
| 50 | Alamat, no HP, WA, umur | `Informasi pribadi tidak diberikan.` |
| 45 | ketemu, offline | `Cuma bisa VCS. Offline tidak tersedia.` |
| 40 | cara vcs, payment | `1. Buka babyval.com\n2. Pilih Video Call\n3. Pilih Durasi\n4. Bayar` |
| 35 | beda 7 dan 10 menit | `Beda durasi aja. Squirt minimal 20 menit.` |
| 35 | masker | `Buka masker: tip 250rb ke ganknow.com/babyval/tip.` |
| 30 | vcs, videocall | `VCS tersedia. babyval.com → Video Call → Durasi → Bayar.` |
| 25 | ngobrol aja | `Chat langsung: membership Tevi.` |
| 20 | payment, transfer | `babyval.com → Video Call → Durasi → Bayar.` |
| 20 | join member | `tevi.com/@cutieval. Pilih membership.` |
| 15 | order, beli | `babyval.com. Pilih layanan, bayar, kirim bukti.` |
| 15 | foto, video, konten | `Konten untuk member.` |
| 10 | bot, sukii | `Sukii. Informan Baby Val.` |
| 5 | terima kasih | `Sukii. Ada yang perlu ditanyakan.` |
| 1 | inappropriate | `Di luar layanan.` |
| 0 | fallback | `Chat langsung dengan Baby Val: membership Tevi.` |

## Greeting

```
Halo aku Sukii, AI Assistant-nya Baby Val 💕
Kalau mau Chat sama Baby Val, membership dulu ya di Tevi
Kalau mau VCS bisa bayar di babyval.com
```

## Page-Ready Guard (v0.7.0)

Bot waits until content-script responds to PING before typing:
- Navigate to DM URL
- Poll PING every 500ms (max 20s total)
- If page not ready → extra 5s wait → retry PING
- Only then type message

## Auto-Recovery (DOM Send)

1. Direct send
2. Inject CS + retry (1.5s wait)
3. Hard refresh + navigate + retry (3s wait + 3s wait)
4. All failed → defer to next poll

## Auto-Reload (Development)

File changes trigger automatic extension reload via CDP:

```bash
cd tevi-cs
npm install        # install ws + chokidar
npm run watch     # auto-reloader.js
```

`auto-reloader.js` watches all extension files. On change → CDP → `__TEVI_RELOAD__` → `chrome.runtime.reload()` → new code active. No manual reload needed.

> Auto-reloader auto-launches Edge with `--remote-debugging-port=9222` if not already running.

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

### 3. Setup
1. Buka tab Tevi → login
2. Extension icon → Keys tab → masukkan AI key + HMAC secret → Save
3. Toggle ON

## Active Hours

Aktif: **17:00 - 05:00 WIB**

## Changelog

### v0.7.2 — 2026-06-26
- **Slow typing**: 30-70ms/char with punctuation pauses (space=50-90ms, period=80-140ms, comma=60-100ms)
- **Pre-type delay**: 1.5s wait before typing starts
- **Post-type delay**: 1.2s pause after finishing typing, before clicking send
- **Post-send verification**: 2s wait + `verifyMessageSent()` checks DOM for message bubble or input cleared
- **Auto-retry**: if verification fails, clicks send button again after 1.5s wait
- **Send button priority**: `dm-chat-send-message-btn` ID first, then aria-label/icon selectors
- **Input guard**: `clickSend()` verifies text is in input before clicking

### v0.7.1 — 2026-06-26
- **Fixed send button blocklist**: added get-star/buy/donate/payment CTA blocklist — wrong button was triggering get-star redirect
- **Fixed greeting template**: now exactly `Halo aku Sukii, AI Assistant-nya Baby Val 💕...`
- **Slug fallback**: use convId when channel_slug missing (prevents undefined URL)
- **Improved navigateToConv**: re-injects CS if PING fails after navigation

### v0.7.0 — 2026-06-26
- **Queue mode**: process ONE conv at a time — no more tab collision with 100 convs
- **Page-ready guard**: `waitForPageReady` via PING — waits for CS to load before typing
- **Send confirmation**: 1.5s wait after clickSend to confirm message appeared
- **Dynamic delays**: greeting=12s, reply=8s, failed=15s, ignored=5s
- **CS v0.7.0**: PING handler, no 60s auto-return (BG handles timing)
- Removed: 3h wait, filter=UNREAD, old tracked loop pattern

### v0.6.2 — 2026-06-25
- Fix: track intro_sent/cs convs via getMessages even after greeting drops them from UNREAD filter
- Idle refresh every 10s on messages page for new chat detection
- Poll loop checks tracked conversations for user replies
- Auto-reloader: CDP-based extension reload on file changes — no manual reload needed

### v0.6.1 — 2026-06-25
- Idle/Reply state machine: auto-return to messages after 60s
- Cold tone: semua reply dingin, informatif
- Sukii-last-replier: skip reply jika Sukii sudah terakhir balas
- Payment proof silent end
- Overlay kucing: CSS animated cat
