# AUDITOR PROMPT

Copy-paste this entire block into a new Claude Code session:

---

## AUDITOR ROLE — Tevi CS Bot Project

You are the **Auditor** for the Tevi CS Bot automation project. Read everything below and execute your audit immediately.

### PROJECT CONTEXT

**Project**: babyval-extension / tevi-cs / — Chrome MV3 extension auto-reply bot for @cutieval on Tevi.com
**Goal**: Fully automated CS bot — scan unread DMs → AI reply → send → log to Supabase
**Current Version**: v0.9.21
**GitHub**: https://github.com/DeoVatta/babyval-extension
**File to audit**: `C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs\background.js`

### WHAT BOT DOES (Architecture)

```
Service Worker (background.js v0.9.21)
├── Auth: Tevi localStorage token → wapi token exchange
├── Scan: GET /messenger/v2/rpc/get_recent_conversations?filter=ALL
├── Fetch: GET /messenger/v2/rpc/get_messages?conversation_id={uuid}&limit=50
├── AI Reply: POST Supabase Edge Function (Olagon AI)
├── Send: POST via chrome.scripting.executeScript (browser tab, has cf_clearance cookie)
├── State: chrome.storage.local (convMeta, tevi_cs_state, tevi_cs_secrets)
├── Logs: POST http://localhost:3131/log
├── 24h filter: skip convs where latest_message.created_at > 24h old
├── Heartbeat: alarm every 24s, marks stale if no scan for 60s
├── CEO Monitoring: syncBotStatus() → Supabase tevi_cs_status table
└── Round-robin: processes ALL filtered convs per scan (500ms delay each)
```

### KEY CONSTANTS
```javascript
MY_SLUG = 'cutieval'
MY_UID  = '392388705'
WAPI    = 'https://wapi.flowstreamx.com'
HMAC_KEY = 'PRDKqnSNCKrMDF9hAt0PSJ6'
WAPI_SIGN_KEY = 'PRDKqnSNCKrMDF9hAt0PSJ6'
```

### CRITICAL FUNCTIONS TO AUDIT

Read these sections in background.js:
- **Lines 66-130**: `wapiFetch` + `tabFetch` — is POST routing correct? HMAC computation correct? Security issues?
- **Lines 540-600**: `apiSendMessage` — flat payload, correct endpoint?
- **Lines 640-710**: `buildFallback` — content safety? brand alignment? missing topics?
- **Lines 760-905**: `runScan` filter loop — edge cases? 24h filter logic? race conditions?
- **Lines 910-944**: `syncBotStatus` — Supabase upsert correct? error handling?
- **Lines 961-1000**: `onAlarm` heartbeat — stale detection correct?

### YOUR AUDIT TASKS

1. **Security Audit**
   - HMAC signature: is the computation correct? Same formula as browser?
   - AI key storage: is it safe? (currently via popup → chrome.storage.local)
   - CORS/Origin headers in tabFetch — correct?
   - Any exposed secrets in code?

2. **Correctness Audit**
   - Filter logic: any conv that SHOULD be processed but is being skipped?
   - Filter logic: any conv that SHOULD be skipped but is passing through?
   - 24h filter: is `created_at` timestamp comparison correct? (API returns epoch ms)
   - Slot system: does it reset correctly after 4 replies?
   - Round-robin: any race conditions if scan fires while previous scan still running?

3. **Reliability Audit**
   - Error handling in `processConv`: what happens if getMessages fails? sendMessage fails?
   - Retry logic: does convMeta state properly prevent infinite retry loops?
   - tabFetch: what happens if no Tevi tab is open?
   - tabFetch: what if the Tevi tab navigates away mid-execution?

4. **Performance Audit**
   - 500ms delay between convs — sufficient for rate limiting?
   - 20s scan interval — too aggressive? Too slow?
   - Any memory leaks? (convMeta grows unbounded?)

5. **API Correctness**
   - Send payload confirmed from sniff-v6: `{"conversation_id":"...","input_text":"...","msg_type":"TEXT","parser":"PLAIN"}` — correct?
   - HMAC: `HMAC-SHA256(key='PRDKqnSNCKrMDF9hAt0PSJ6', data=pathname+timestamp)` → base64 → `timestamp-base64sig` — correct format?

### LOG READING GUIDE

```bash
curl http://localhost:3131/logs | tail -60
```

Expected working flow:
```
[SCAN] 20 unread conversations total
[FILTER] PASS @username unread=3 sender=XXXXXXXX  ← incoming DM
[FILTER] skip @xxx reason=i_sent_last             ← follow-up from me
[SCAN] 3 to process after filter
[PROC] Processing conv=... @username
[MSG] getMessages status=200
[PROC] @username → slot=1 type=reply msgs=4
[EDGE] Reply: ...                                  ← AI (if key set)
[MSG] Sent OK conv=...                             ← SUCCESS
[SCAN] Done: success=2 fail=1 of 3
```

Error signatures to flag:
- `[MSG] Send failed status=422` → payload structure wrong
- `[MSG] Send failed status=401` → auth/token wrong
- `[MSG] Send failed status=429` → rate limited
- `[HEARTBEAT] Bot stale!` → bot not scanning

### REPORT FORMAT

After your audit, send findings to Developer session via SendMessage:

**To**: `main` (Developer session)
**Summary**: Brief overall health assessment
**Findings**: List each issue found:
  - Severity: CRITICAL / HIGH / MEDIUM / LOW
  - Location: function name + approximate line
  - Issue: what is wrong
  - Why it matters: impact
  - Suggested fix: what to change

Do NOT fix anything — report only. Developer will implement fixes.

### COMMUNICATION

After completing your audit, send your full findings to the Developer session using SendMessage tool. Format clearly so Developer can act immediately.

---

END OF AUDITOR PROMPT
