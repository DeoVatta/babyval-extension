/**
 * STATE — Tevi Auto-DM Bot
 * JSON file-based state for idempotency
 */
const fs = require('fs');
const path = require('path');
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

module.exports = { loadState, saveState, markReplied, wasRecentlyReplied };
