/**
 * CONFIG — Tevi Auto-DM Bot
 * Permanent Playwright browser + Direct API send
 */
const path = require('path');

module.exports = {
  // Browser
  CHROMIUM_PATH: 'C:/Users/Devata/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',

  // Tevi credentials
  EMAIL: 'cutievalbaby@gmail.com',
  PASSWORD: '@DevataHEHE01',

  // Bot identity
  MY_UID: '392388705',
  MY_SLUG: 'cutieval',

  // Paths
  STATE_PATH: path.join(__dirname, 'state.json'),
  LOG_PATH: path.join(__dirname, 'bot.log'),

  // Timing
  POLL_INTERVAL_MS: 3 * 60 * 1000,    // 3 minutes
  LOGIN_WAIT_MS: 13000,               // CF challenge wait
  NAV_WAIT_MS: 8000,                  // wait for API after page load
  SEND_DELAY_MS: 1000,                // delay between sends

  // Active hours (WIB = UTC+7)
  // Active: 17:00-05:00 WIB = 10:00-22:00 UTC
  ACTIVE_HOURS_START: 10, // UTC
  ACTIVE_HOURS_END: 22,   // UTC

  // Supabase Edge Function for AI replies
  EDGE_FUNC: 'https://qjemyvydivekolywleji.supabase.co/functions/v1/cs-bot-logger',

  // Olagon AI key — set via env var or config below
  // Get from: https://gateway.olagon.site
  AI_KEY: process.env.AI_KEY || '',

  // HMAC
  WAPI_SIGN_KEY: 'PRDKqnSNCKrMDF9hAt0PSJ6',

  // Image cooldown (ms)
  IMG_COOLDOWN_MS: 6 * 60 * 60 * 1000,

  // Max messages to fetch per conv
  MAX_MSGS: 4,

  // Max reply slot before reset (slot 1-4, then reset to greeting)
  MAX_SLOT: 4,
};
