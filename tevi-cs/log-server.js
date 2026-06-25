/**
 * LOG SERVER — Tevi CS Extension Diagnostic Logger
 * Tiny HTTP server: receives logs from extension → writes to file
 * Saya (Claude) polling/ baca log file untuk debug & fix
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3131;
const LOG_FILE = path.join(__dirname, 'tevi-cs-logs.txt');
const MAX_LINES = 2000; // keep last 2000 lines

// Ensure log file exists
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
}

function getTimestamp() {
  return new Date().toISOString();
}

function appendLog(line) {
  const ts = getTimestamp();
  const entry = `[${ts}] ${line}\n`;
  fs.appendFileSync(LOG_FILE, entry);

  // Rotate: keep only last MAX_LINES
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  if (lines.length > MAX_LINES) {
    const trimmed = lines.slice(-MAX_LINES).join('\n') + '\n';
    fs.writeFileSync(LOG_FILE, trimmed);
  }

  // Also print to stdout for real-time monitoring
  console.log(`[LOG] ${entry.trim()}`);
}

function readLogs(count = 200) {
  if (!fs.existsSync(LOG_FILE)) return '';
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  return lines.slice(-count).join('\n');
}

function readStats() {
  if (!fs.existsSync(LOG_FILE)) return { lines: 0, size: 0, oldest: null, newest: null };
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  return {
    lines: lines.length,
    size: Buffer.byteLength(content, 'utf8'),
    oldest: lines[0] || null,
    newest: lines[lines.length - 1] || null,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // ── POST /log ──────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/log') {
      let body = '';
      for await (const chunk of req) { body += chunk; }

      let entry;
      try {
        const json = JSON.parse(body);
        entry = `[${json.source || 'EXT'}] [${json.level || 'INFO'}] ${json.message}`;
        if (json.data) entry += ` | ${JSON.stringify(json.data)}`;
      } catch {
        entry = `[EXT] ${body}`;
      }

      appendLog(entry);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, lines: readStats().lines }));
      return;
    }

    // ── POST /batch ────────────────────────────────────────────────────────
    if (method === 'POST' && url.pathname === '/batch') {
      let body = '';
      for await (const chunk of req) { body += chunk; }

      let entries;
      try {
        entries = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      for (const entry of entries) {
        const line = `[${entry.source || 'EXT'}] [${entry.level || 'INFO'}] ${entry.message}`;
        appendLog(line);
      }

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, count: entries.length }));
      return;
    }

    // ── GET /logs ──────────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/logs') {
      const count = parseInt(url.searchParams.get('count') || '200');
      const logs = readLogs(count);
      res.writeHead(200);
      res.end(JSON.stringify({ logs, stats: readStats() }));
      return;
    }

    // ── GET /health ────────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        uptime: process.uptime(),
        stats: readStats(),
        timestamp: getTimestamp(),
      }));
      return;
    }

    // ── GET /clear ────────────────────────────────────────────────────────
    if (method === 'GET' && url.pathname === '/clear') {
      fs.writeFileSync(LOG_FILE, '');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── 404 ────────────────────────────────────────────────────────────────
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (e) {
    console.error('[SERVER ERROR]', e.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[LOG SERVER] Running on http://localhost:${PORT}`);
  console.log(`[LOG SERVER] Log file: ${LOG_FILE}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /log     — Send single log entry');
  console.log('  POST /batch   — Send multiple log entries');
  console.log('  GET  /logs    — Read recent logs');
  console.log('  GET  /logs?count=N — Read N recent lines');
  console.log('  GET  /health  — Server health check');
  console.log('  GET  /clear   — Clear log file');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  server.close(() => {
    console.log('[SERVER] Stopped.');
    process.exit(0);
  });
});
