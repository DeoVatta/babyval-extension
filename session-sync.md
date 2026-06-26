# SESSION SYNC — Tevi CS Bot Automation

> **Project**: babyval-extension / tevi-cs/
> **Goal**: Fully automated CS bot for @cutieval (UID=392388705) on Tevi.com
> **Status**: v0.9.20 — P0 issues remaining before stable
> **Updated**: 2026-06-26

---

## ROLES

| Role | Session | Responsibility |
|------|---------|----------------|
| **CEO** | user (Devata) | Communication hub, final decisions, deployment |
| **Developer** | this session | Implementation, fixes, architecture |
| **Auditor** | audit session | Code review, bug detection, security, API correctness |
| **Tester** | test session | Functional testing, log analysis, edge cases |

**Communication**: Semua session WAJIB kirim update ke CEO via regular reports. Auditor + Tester kirim temuan ke Developer session via inline findings.

---

## CURRENT ARCHITECTURE

```
Tevi.com (browser)
├── Content Script (content-script.js)
│   ├── Token capture from localStorage['user_logged_list']
│   └── Message listener (SCAN_CONVS, DOM_SEND, GET_MSGS, etc.)
│
├── Overlay (overlay.js)
│   └── Cat toggle panel + Reset State button
│
└── Service Worker (background.js) ← MAIN LOGIC
    ├── Auth: Tevi token → wapi token (Firebase anonymous)
    ├── Scan: GET /messenger/v2/rpc/get_recent_conversations?filter=ALL
    ├── Fetch: GET /messenger/v2/rpc/get_messages?conversation_id={uuid}&limit=50
    ├── AI Reply: POST Supabase Edge Function (cs-bot-logger) → Olagon AI
    ├── Send: POST /messenger/v2/rpc/send_message (via browser tab, has cf_clearance cookie)
    ├── State: chrome.storage.local (convMeta, tevi_cs_state, tevi_cs_secrets)
    └── Logs: POST http://localhost:3131/log
```

### Key Constants
```javascript
MY_SLUG = 'cutieval'
MY_UID  = '392388705'  // cutieval's numeric ID
WAPI    = 'https://wapi.flowstreamx.com'
HMAC_KEY = 'PRDKqnSNCKrMDF9hAt0PSJ6'
```

### Send Payload (confirmed from sniff-v6)
```json
{"conversation_id":"...","input_text":"...","msg_type":"TEXT","parser":"PLAIN"}
```

---

## KNOWN ISSUES (Priority Order)

### P0 — Blocking
| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | **422 Send — still failing?** | TEST NEEDED | `opts.body` + `tabFetch` applied in v0.9.20. Need verify `[MSG] Sent OK` in logs |
| 2 | **AI Key not set** | NEEDS ACTION | Set via popup Keys tab (stored in chrome.storage.local). Without it → fallback template only |
| 3 | **cf_clearance cookie context** | TEST NEEDED | `tabFetch` routes POST via browser tab. Confirm tab is active and cf cookie available |

### P1 — High Priority
| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 4 | **markRead returns 404** | NOT FIXED | `POST /messenger/v2/conversation/{uuid}/read/` — wrong endpoint. Needs discovery |
| 5 | **24-hour filter not implemented** | NOT BUILT | Filter by `latest_message.created_at` vs `Date.now()` — only reply convs <24h old |
| 6 | **Supabase logging** | UNCLEAR | Edge function `cs-bot-logger` — not verified if logging to DB actually works |

### P2 — Medium
| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 7 | **Round-robin rate limit** | TEST NEEDED | 500ms delay between convs. With many convs → may need backpressure |
| 8 | **Slot system** | WORKS | 1-4 slots per user, then reset. Seems functional |
| 9 | **Fallback template** | WORKS | Keyword matching works when AI key missing |

### P3 — Nice to Have
| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 10 | Image cooldown | NOT BUILT | User sends image → skip 6 hours |
| 11 | Subscriber bypass | code exists | Should skip subscribers but not tested |
| 12 | MarkRead alternative | Needs research | Find correct Tevi endpoint for marking read |

---

## WORKFLOW TO DO

### Developer (this session)
- [ ] Fix `apiMarkRead` — discover correct endpoint via browser network tab or Tevi JS bundle
- [ ] Implement 24-hour filter in `runScan()` filter loop
- [ ] Implement image cooldown in `processConv()`
- [ ] Verify Supabase edge function `cs-bot-logger` actually logs

### Auditor
- [ ] Review `tabFetch` implementation for security issues
- [ ] Check `wapiFetch` HMAC computation for correctness
- [ ] Audit filter logic for edge cases (empty slug, null sender, etc.)
- [ ] Review `buildFallback` for content safety / brand alignment
- [ ] Check rate limiting: 20s scan interval + 500ms inter-conv delay

### Tester
- [ ] Reload extension v0.9.20, verify `[MSG] Sent OK` in logs
- [ ] If 422 still: capture exact request/response via `curl` to sniffer or browser devtools
- [ ] Test with AI key set: verify AI reply appears instead of fallback
- [ ] Test round-robin: ensure multiple convs get processed in one scan
- [ ] Edge cases: conv with 0 messages, conv with images, conv where sender is numeric ID only

---

## TEST PLAN

### Baseline: Verify Send Works
1. Set AI key in popup Keys tab (Olagon: `rk_live_a...`)
2. Toggle ON
3. Wait for scan cycle (20s)
4. Check logs: `curl http://localhost:3131/logs | tail -30`
5. Expected: `[MSG] Sent OK conv=xxxxxxx`

### Round-Robin Test
1. Ensure 3+ convs have PASS status
2. Reload extension
3. Check logs: should see `success=N fail=N of N` where N > 1

### 24-Hour Filter Test (after implement)
1. Send test DM from another account
2. Bot should reply
3. Wait 24h (mock `Date.now()` for test)
4. Bot should skip

---

## LOG READING GUIDE

```
[SCAN] 20 unread conversations total        ← scan started
[FILTER] PASS @username unread=3 sender=XXXXXXXX  ← incoming DM, will process
[FILTER] skip @xxx reason=i_sent_last       ← follow-up from cutieval
[FILTER] skip @xxx reason=no_unread         ← already read
[SCAN] 3 to process after filter           ← ready to process
[PROC] Processing conv=... @username       ← fetching messages
[MSG] getMessages status=200                ← messages fetched
[PROC] @username → slot=1 type=reply msgs=4  ← generating reply
[EDGE] Reply: ...                           ← AI reply (if key set)
[MSG] Sent OK conv=...                      ← ✅ SEND SUCCESS
[PROC] @username sent=true                  ← process complete
[SCAN] Done: success=2 fail=1 of 3         ← scan complete
```

---

## API REFERENCE

### Endpoints (Confirmed Working)
| Method | Path | Context | Status |
|--------|------|---------|--------|
| GET | `/messenger/v2/rpc/get_recent_conversations?filter=ALL` | SW fetch | ✅ 200 |
| GET | `/messenger/v2/rpc/get_messages?conversation_id=&limit=50` | SW fetch | ✅ 200 |
| POST | `/messenger/v2/rpc/send_message` | Browser tab | ✅ 200 (v0.9.20 fix) |
| POST | `/messenger/v2/conversation/{id}/read/` | Browser tab | ❌ 404 |

### HMAC Verify
```
key = 'PRDKqnSNCKrMDF9hAt0PSJ6'
data = pathname + timestamp (e.g. '/messenger/v2/rpc/send_message1751412000')
sig = base64(HMAC-SHA256(key, data))
verify = timestamp + '-' + sig
```

---

## REPO STRUCTURE
```
babyval-extension/
├── tevi-cs/
│   ├── background.js       ← main service worker (v0.9.20)
│   ├── content-script.js   ← token capture + DOM listeners
│   ├── overlay.js          ← cat toggle panel
│   ├── manifest.json       ← v0.9.20
│   ├── version.js          ← single source of truth
│   ├── log-server.js       ← local log receiver (port 3131)
│   └── README.md           ← full project docs
│
└── supabase/
    └── functions/
        └── cs-bot-logger/  ← Supabase Edge Function (AI + DB logging)
```

---

## SUPABASE TABLES
```sql
cs_users          -- username, membership_status, payment_count, timestamps
cs_chat_logs      -- username, sender, message, has_image, slot, reply_type, ai_model, tokens_used
cs_payment_proofs -- username, image_url, amount, verified
tevi_auth_tokens  -- token, user_id, username, expires_at, is_active
```

---

## WHAT'S MISSING (from user question)

```
✅ Send pipeline (fixed v0.9.19-20)
✅ Filter logic (UNREAD → ALL + sender check)
✅ Round-robin (v0.9.20)
✅ Browser context for POST (v0.9.20)
⬜ 24-hour filter (not built)
⬜ Image cooldown (not built)
⬜ markRead correct endpoint (404)
⬜ Supabase logging verification (not tested)
⬜ Subscriber bypass (code exists, not tested)
⬜ Error recovery: if send fails, retry next cycle (partially done via convMeta)

## MISSING FOR FULLY AUTOMATION

### Monitoring & Alerting
| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| M1 | **Bot heartbeat** | HIGH | Alarm-based heartbeat. If no scan for 2x poll interval → alert CEO |
| M2 | **Supabase status table** | HIGH | `tevi_cs_status` — last_scan_at, success_count, fail_count, bot_state |
| M3 | **CEO notification** | HIGH | Discord/Telegram webhook when bot fails 3x consecutively |
| M4 | **Dashboard URL** | MED | Simple Supabase page CEO can check anytime |

### Operational
| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| O1 | **State backup** | MED | Sync convMeta to Supabase every N minutes — survive browser reset |
| O2 | **Auto-reload on crash** | HIGH | Service Worker crash recovery via alarm |
| O3 | **Rate limit backpressure** | MED | Exponential backoff if API returns 429 |

### Production
| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| P1 | **CI/CD on push** | LOW | GitHub Actions → auto-reload extension? |
| P2 | **Multi-account scaling** | LOW | Multiple Tevi accounts → multiple bot instances |
| P3 | **Version diff notification** | LOW | Notify CEO when new version pushed |
```

---

## VERSION HISTORY

| Version | Commit | Key Changes |
|---------|--------|-------------|
| 0.9.20 | 1e3a270 | tabFetch + round-robin |
| 0.9.19 | 6f33861 | wapiFetch body fix |
| 0.9.18 | — | filter=ALL + flat payload |
| 0.9.17 | — | sender check + debug logging |
| 0.9.16 | — | Reset State button |

---

## QUICK START (for new session)

1. Read `tevi-cs/README.md` for full context
2. Read `tevi-cs/background.js` — lines 1-100 (architecture), 540-562 (apiSendMessage), 700-844 (processConv + runScan)
3. Check logs: `curl http://localhost:3131/logs | tail -50`
4. Check current version in `tevi-cs/version.js`
5. Reference `session-sync.md` for this document

**File paths**: `C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs\`
**Git remote**: `https://github.com/DeoVatta/babyval-extension.git`
