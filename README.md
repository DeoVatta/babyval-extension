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

## State Machine — v0.9.1

```
TOGGLE ON
  ↓
SCAN (every 20s alarm OR tab switch)
  → Navigate to messages page
  → SCAN_CONVS: find convs with no ✓/✓✓ icon
  → Filter: skip membership, skip image-cooldown (6h), skip self
  ↓
PROCESS ONE CONV
  → Navigate to @slug/messages
  → GET_MSGS: read 4 latest USER messages (not Sukii)
  → SLOT DECISION:
      no prior meta → greeting (slot=1)
      slot >= 4 → greeting (slot=1) ← reset after 4 replies
      else → reply (slot++)
  → Generate reply: greeting or AI/fallback
  → Send via API (tabless) or DOM fallback
  → Update convMeta: slot, status, timestamps
  ↓
Return to messages, idle 20s → repeat
```

## DOM Detection (v0.9.1)

```
✓✓ (icon-check-double) on last conv msg → Sukii replied → SKIP
✓ (icon-check) on last conv msg → Sukii replied → SKIP
No icon / other icon → USER last message → NEEDS REPLY
Membership badge (member/premium/VIP) → SKIP entirely
Image sender → cooldown 6h → SKIP
```

## Slot System (v0.9.1)

| Slot | Type | Description |
|------|------|-------------|
| 1 | Greeting | `Halo aku Sukii...` (always greeting) |
| 2 | Reply | AI/fallback with 4-msg context |
| 3 | Reply | AI/fallback with 4-msg context |
| 4 | Reply | AI/fallback with 4-msg context |
| 5+ | Greeting | After slot 4, resets to slot 1 |

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

## Queue Mode (v0.9.1 — ONE conv at a time)

```
Alarm fires every 20s (or user switches to Tevi tab)
  → Navigate to messages page
  → SCAN_CONVS: query DOM for all convs with no ✓/✓✓ icon
  → Filter: skip self, skip processing convs, skip >3 nav fails, skip image-cooldown users
  → Pick first remaining conv
  → Navigate to DM → GET_MSGS (4 USER msgs) → decideSlot → apiSend (tabless) or domSend (fallback)
  → Update convMeta (slot, status, timestamps)
  → Return to messages
  → Alarm fires again in ~20s
```

**Navigate recovery:** If tab not responding, recreate tab + inject CS. After 3 fails, skip that conv.

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

Aktif: **24/7** — no active hours restriction, user controls ON/OFF via extension toggle.

## Changelog

### v0.9.1 — 2026-06-26
- **FIX: hasRepliedIcon** — correct ✓/✓✓ detection (was always returning true)
- **FIX: scanConvs** — AND logic: only unreplied if no check icon AND not membership
- **FIX: lastMsgTs** — extracted from conv list item datetime attribute
- **FIX: popup↔BG bridge** — BG now handles GET_CONFIG, SAVE_CONFIG, SET_SECRETS, GET_STATUS, RESET_STATE
- **FIX: generateReply fallback** — no null return, always returns template
- **FIX: isFromUser** — 7-strategy detection (alignment, avatar, sender name, check icon, prefix, image, CSS)
- **FIX: findConvItems** — 5-priority selector (data attr → class → href → list → fallback)
- **FIX: navigateFailCount** — properly incremented on navigate failure
- **FIX: membership detection** — skip entirely during conv scanning
- **FIX: API body handling** — JSON parse before storing, smart field reconstruction
- **FEAT: chrome.tabs.onActivated** — scan immediately when user switches to Tevi tab
- **FEAT: greeting from config** — reads from tevi_cs_config persona.greeting
- **FEAT: convMeta cleanup** — clears 48h+ stale entries on every init
- **CLEANUP: dead code removed** (popup.js orphaned, unused DOM_SEND stubs)

### v0.9.0 — 2026-06-26
- **Complete rewrite** of content-script.js + background.js
- **DOM-based conv detection**: scan for ✓/✓✓ icons instead of message polling — no more wapi.flowstreamx.com dependency
- **4-message context window**: reads 4 latest USER messages before each reply
- **Slot system**: greeting (slot=1) → 3 AI replies (slot 2-4) → greeting loop
- **Image sender cooldown**: 6h cooldown tracked by username in chrome.storage
- **Greeting cooldown**: 3h per conversation before new greeting fires
- **Idle 20s refresh**: chrome.alarms fires every 20s, scans messages page, processes one conv
- **Simplified flow**: scan → filter → navigate → read → decide → send → return → idle

### v0.7.3 — 2026-06-26
- **Fixed overlay sync**: `botEnabled` now written to overlay storage on every poll/toggle — cat panel always shows correct ON/OFF
- **Fixed queueBusy freeze**: SW now resets `queueBusy` and clears stale queue on startup — bot no longer frozen after service worker wakes
- **24/7 mode**: Active hours restriction removed — user controls ON/OFF freely via extension popup
- **Fixed pollTime display**: poll time now correctly shown in overlay panel

### v0.7.2 — 2026-06-26
- **Fixed tab staleness**: `navigateToConv` and `domSendWithConfirm` now get fresh tab every time — no more `[ALARM] No tab with id` errors
- **Slow laptop waits**: navigate wait=5s, inject wait=4s, refresh wait=5s, PING poll=1s (up from 500ms)
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
