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

function sql(query, params) {
  try {
    let q = query;
    if (params) {
      for (const k of Object.keys(params)) {
        const val = params[k];
        const escaped = String(val).replace(/'/g, "''");
        q = q.replace(new RegExp(':' + k + '\\b', 'g'), "'" + escaped + "'");
      }
    }
    const out = execSync(`"${SQLITE}" -json "${DB}"`, {
      input: q, encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, windowsHide: true, timeout: 10000
    });
    return JSON.parse(out || '[]');
  } catch (e) {
    throw new Error(e.message.substring(0, 300));
  }
}

function sqlExec(query, params) {
  try {
    let q = query;
    if (params) {
      for (const k of Object.keys(params)) {
        const val = params[k];
        const escaped = String(val).replace(/'/g, "''");
        q = q.replace(new RegExp(':' + k + '\\b', 'g'), "'" + escaped + "'");
      }
    }
    execSync(`"${SQLITE}" "${DB}"`, {
      input: q, encoding: 'utf-8',
      windowsHide: true, timeout: 10000
    });
    return true;
  } catch (e) {
    throw new Error(e.message.substring(0, 300));
  }
}

function getSessions() {
  return sql(`SELECT id, title, time_created, time_updated,
    datetime(time_created/1000,'unixepoch','localtime') as created_at,
    datetime(time_updated/1000,'unixepoch','localtime') as updated_at,
    model, agent, cost, tokens_input, tokens_output, tokens_reasoning
    FROM session ORDER BY time_created DESC LIMIT 100`);
}

function getSession(sessionId) {
  return sql(`SELECT id, title, time_created,
    datetime(time_created/1000,'unixepoch','localtime') as created_at,
    model, agent, cost, tokens_input, tokens_output, tokens_reasoning
    FROM session WHERE id = :id LIMIT 1`, { id: sessionId })[0] || null;
}

function getMessages(sessionId) {
  return sql(`SELECT m.time_created as msg_time,
    json_extract(m.data, '$.role') as role,
    json_extract(p.data, '$.type') as part_type,
    json_extract(p.data, '$.text') as text,
    p.time_created as part_time
    FROM message m JOIN part p ON p.message_id = m.id
    WHERE m.session_id = :sid
    AND json_extract(p.data, '$.type') IN ('text','tool','tool-result','reasoning')
    ORDER BY m.time_created, p.time_created`, { sid: sessionId });
}

function deleteSession(sessionId) {
  sqlExec(`DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id = :sid)`, { sid: sessionId });
  sqlExec(`DELETE FROM message WHERE session_id = :sid`, { sid: sessionId });
  sqlExec(`DELETE FROM session WHERE id = :sid`, { sid: sessionId });
  return true;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getHTML());

    } else if (pathname === '/api/sessions') {
      json(res, getSessions());

    } else if (pathname.startsWith('/api/session/') && req.method === 'DELETE') {
      const id = pathname.slice('/api/session/'.length);
      deleteSession(id);
      json(res, { success: true });

    } else if (pathname.startsWith('/api/session/')) {
      const id = pathname.slice('/api/session/'.length);
      json(res, getSession(id));

    } else if (pathname.startsWith('/api/messages/')) {
      const id = pathname.slice('/api/messages/'.length);
      json(res, getMessages(id));

    } else {
      json(res, { error: 'Not found' }, 404);
    }
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log('My AI Dashboard: http://localhost:' + PORT);
});
