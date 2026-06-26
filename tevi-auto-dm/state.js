/**
 * STATE — Tevi Auto-DM Bot
 * JSON file-based state for idempotency + slot + cooldown tracking
 */
const fs = require('fs');
const cfg = require('./config');

function loadState() {
  if (fs.existsSync(cfg.STATE_PATH)) {
    try { return JSON.parse(fs.readFileSync(cfg.STATE_PATH, 'utf8')); }
    catch { /* corrupt file */ }
  }
  return { repliedOnce: {}, lastRun: null };
}

function saveState(state) {
  fs.writeFileSync(cfg.STATE_PATH, JSON.stringify(state, null, 2));
}

function markReplied(convId, state) {
  state.repliedOnce[convId] = Date.now();
  saveState(state);
}

function wasRecentlyReplied(convId, state, maxAgeMs = 5 * 60 * 1000) {
  const ts = state.repliedOnce[convId];
  if (!ts) return false;
  return (Date.now() - ts) < maxAgeMs;
}

/**
 * Get slot info for a user (slug).
 * Returns { slot, lastReplyAt } or defaults.
 */
function getSlotInfo(slug) {
  const st = loadState();
  const key = '_slot_' + slug.toLowerCase();
  const tsKey = '_replyTs_' + slug.toLowerCase();
  return {
    slot: st.repliedOnce[key] || 0,
    lastReplyAt: st.repliedOnce[tsKey] || null,
  };
}

/**
 * Increment slot for a user — called AFTER confirmed sent.
 */
function commitSlot(slug) {
  const st = loadState();
  const key = '_slot_' + slug.toLowerCase();
  const tsKey = '_replyTs_' + slug.toLowerCase();
  const current = st.repliedOnce[key] || 0;
  st.repliedOnce[key] = current + 1;
  st.repliedOnce[tsKey] = Date.now();
  saveState(st);
}

/**
 * Check if slot should reset to greeting.
 * Reset if: last reply was > SLOT_RESET_HOURS hours ago.
 */
function shouldResetSlot(slug) {
  const { slot, lastReplyAt } = getSlotInfo(slug);
  if (slot === 0) return false; // never replied — greeting anyway
  if (!lastReplyAt) return false;
  const RESET_HOURS = 3;
  return (Date.now() - lastReplyAt) > RESET_HOURS * 60 * 60 * 1000;
}

module.exports = {
  loadState, saveState, markReplied, wasRecentlyReplied,
  getSlotInfo, commitSlot, shouldResetSlot,
};
