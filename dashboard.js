const http = require('http');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SQLITE = (() => {
  const candidates = process.env.SQLITE3_PATH
    ? [process.env.SQLITE3_PATH]
    : ['sqlite3',
      path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages', 'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe', 'platform-tools', 'sqlite3.exe'),
      path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe', 'platform-tools', 'sqlite3.exe'),
    ];
  for (const c of candidates) {
    try { execSync(c + ' --version', { windowsHide: true, timeout: 2000 }); return c; } catch {}
  }
  return 'sqlite3';
})();
const DB = process.env.OPCODE_DB || path.join(process.env.USERPROFILE, '.local', 'share', 'opencode', 'opencode.db');
const HTML_FILE = path.join(__dirname, 'dashboard.html');
const PORT = parseInt(process.env.DASHBOARD_PORT, 10) || 3344;

let htmlCache = null;
function getHTML() {
  if (!htmlCache) htmlCache = fs.readFileSync(HTML_FILE, 'utf-8');
  return htmlCache;
}

function sql(query) {
  try {
    const out = execSync(`"${SQLITE}" -json "${DB}"`, {
      input: query, encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, windowsHide: true, timeout: 10000
    });
    return JSON.parse(out || '[]');
  } catch (e) {
    console.error('SQL error:', e.message.substring(0, 200));
    return [];
  }
}

function getSessions() {
  return sql(`SELECT id, title, time_created, time_updated,
    datetime(time_created/1000,'unixepoch','localtime') as created_at,
    datetime(time_updated/1000,'unixepoch','localtime') as updated_at,
    model, agent
    FROM session ORDER BY time_created DESC LIMIT 100`);
}

function getMessages(sessionId) {
  const safeId = sessionId.replace(/'/g, "''");
  return sql(`SELECT m.time_created as msg_time,
    json_extract(m.data, '$.role') as role,
    json_extract(p.data, '$.type') as part_type,
    json_extract(p.data, '$.text') as text,
    p.time_created as part_time
    FROM message m JOIN part p ON p.message_id = m.id
    WHERE m.session_id = '${safeId}'
    AND json_extract(p.data, '$.type') IN ('text','tool','tool-result','reasoning')
    ORDER BY m.time_created, p.time_created`);
}

function getSession(sessionId) {
  const safeId = sessionId.replace(/'/g, "''");
  const r = sql(`SELECT id, title, time_created,
    datetime(time_created/1000,'unixepoch','localtime') as created_at,
    model, agent, cost, tokens_input, tokens_output, tokens_reasoning
    FROM session WHERE id = '${safeId}' LIMIT 1`);
  return r[0] || null;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (req.url === '/' || req.url === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getHTML());

    } else if (req.url === '/api/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getSessions()));

    } else if (req.url.startsWith('/api/session/')) {
      const id = req.url.slice('/api/session/'.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getSession(id)));

    } else if (req.url.startsWith('/api/messages/')) {
      const id = req.url.slice('/api/messages/'.length);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getMessages(id)));

    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log('My AI Dashboard: http://localhost:' + PORT);
});
