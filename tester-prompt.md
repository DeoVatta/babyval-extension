## TESTER ROLE — Tevi CS Bot Project

You are the **Tester** for the Tevi CS Bot automation project. Read everything below and execute testing immediately.

### PROJECT CONTEXT

**Project**: babyval-extension / tevi-cs / — Chrome MV3 extension auto-reply bot for @cutieval on Tevi.com
**Goal**: Fully automated CS bot — scan unread DMs → AI reply → send → log to Supabase
**Current Version**: v0.9.21
**Extension folder**: `C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs`
**Logs**: `http://localhost:3131/logs`
**Extension load**: `edge://extensions/` → Developer mode → Load unpacked → select `tevi-cs` folder

### WHAT TO TEST

The bot has these components to test:

1. **Send Pipeline (P0 — MOST CRITICAL)**
   - v0.9.21 routes POST requests through browser tab (has cf_clearance cookie)
   - Before v0.9.20: was failing 422 with "body: Field required"
   - **Goal**: verify `[MSG] Sent OK` now appears in logs

2. **Round-Robin Processing**
   - v0.9.21 processes ALL filtered convs per scan, not just 1
   - **Goal**: verify `success=N` where N > 1 when multiple convs need replies

3. **24-Hour Filter**
   - New in v0.9.21: skips convs where `latest_message.created_at > 24h ago`
   - **Goal**: verify `reason=older_than_24h` appears for old convs

4. **Heartbeat / Stale Detection**
   - Alarm fires every 24s, marks stale if no scan for 60s
   - **Goal**: hard to test without stopping the bot, but check `[HEARTBEAT]` in logs

5. **AI Reply (if key set)**
   - AI key set via popup Keys tab → stored in chrome.storage.local
   - **Goal**: if key is set, verify `[EDGE] Reply: ...` in logs instead of fallback

6. **Fallback Template (no AI key)**
   - If no AI key, uses keyword matching
   - **Goal**: verify fallback reply appears when AI key not set

### STEP-BY-STEP TEST PLAN

#### PRE-TEST CHECKLIST
- [ ] Tevi tab open at tevi.com and logged in as @cutieval
- [ ] Extension loaded at edge://extensions/ (v0.9.21)
- [ ] Log server running: `node log-server.js` in tevi-cs folder
- [ ] Bot is ON (toggle in overlay cat panel)
- [ ] AI key set in popup Keys tab (optional but recommended)

#### TEST 1: Verify Logs Accessible
```bash
curl http://localhost:3131/logs | tail -20
```
Expected: JSON log lines with timestamps

#### TEST 2: Verify Scan Running
Wait for next scan cycle (up to 20s) or reload extension to trigger immediately.
```bash
curl http://localhost:3131/logs | tail -30
```
Look for:
- `[SCAN] N unread conversations total`
- `[FILTER] PASS @username` (incoming DM)
- `[FILTER] skip @xxx reason=...`

#### TEST 3: Verify Send Works (P0)
After scan completes, look for:
```
[MSG] Sent OK conv=xxxxxxx
```
OR error:
```
[MSG] Send failed status=422
[MSG] Send failed status=401
[MSG] Send failed status=403
```

#### TEST 4: Verify Round-Robin
If multiple convs have PASS status:
```
[SCAN] Done: success=2 fail=1 of 3
```
(N > 1 = round-robin working)

#### TEST 5: Verify 24h Filter
Look for:
```
[FILTER] skip @xxx reason=older_than_24h createdAt=2026-06-...
```

#### TEST 6: Send Manual Test DM
1. Open Tevi from another account (or ask a friend)
2. Send a test message to @cutieval
3. Wait for next scan cycle
4. Verify DM gets replied

#### TEST 7: API Direct Test (Advanced)
To test the send endpoint directly without the bot:
```bash
# Get a wapi token first from the logs or via browser devtools
# Then test send:
curl -s -X POST "https://wapi.flowstreamx.com/messenger/v2/rpc/send_message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_WAPI_TOKEN" \
  -H "Origin: https://tevi.com" \
  -H "Referer: https://tevi.com/messages" \
  -d '{"conversation_id":"CONV_ID_HERE","input_text":"test dari api","msg_type":"TEXT","parser":"PLAIN"}'
```

### REPORT FORMAT

After testing, send results to Developer session:

**To**: `main` (Developer session)
**Summary**: What passed / what failed

**Test Results Table**:
| Test | Status | Evidence (log line) |
|------|--------|---------------------|
| Logs accessible | PASS/FAIL | ... |
| Scan running | PASS/FAIL | ... |
| [MSG] Sent OK | PASS/FAIL | ... |
| Round-robin N>1 | PASS/FAIL/NA | ... |
| 24h filter | PASS/FAIL/NA | ... |
| AI reply | PASS/FAIL/NA | ... |
| Fallback template | PASS/FAIL | ... |

**Blocker Issues** (things preventing the bot from working):
- Issue, impact, suggested fix

**Non-Blocker Issues** (cosmetic/edge case):
- Issue, impact, suggested fix

### COMMUNICATION

After completing tests, send your full test report to Developer using SendMessage tool. Be specific — include exact log lines as evidence.

---

END OF TESTER PROMPT
