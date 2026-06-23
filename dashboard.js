const http = require('http');
const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

var TAILSCALE_BIN = (function(){ try { var p = 'C:\\Program Files\\Tailscale\\tailscale.exe'; if (fs.existsSync(p)) return p; } catch(e){} return 'tailscale'; })();

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
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const CHAT_FILE = path.join(__dirname, 'chat.json');
const AUTH_FILE = path.join(__dirname, 'auth.json');
const KNOWLEDGE_FILE = path.join(__dirname, 'knowledge.json');
const PORT = parseInt(process.env.DASHBOARD_PORT, 10) || 3344;
const _tokens = new Set();

function loadKnowledge() {
  try {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, 'utf-8'));
    }
  } catch {}
  return { entries: [] };
}

function saveKnowledge(data) {
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function extractKnowledgeFromSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  const knowledge = loadKnowledge();
  if (knowledge.entries.some(e => e.sessionId === sessionId)) return null;
  const messages = getMessages(sessionId);
  const textParts = messages.filter(m => m.text).map(m => m.text);
  const firstUserMsg = textParts.find(t => t && t.length > 10) || '';
  const summary = firstUserMsg.length > 500 ? firstUserMsg.substring(0, 500) + '...' : firstUserMsg;
  const tags = [];
  try { const t = JSON.parse(session.tags || '[]'); if (Array.isArray(t)) tags.push(...t); } catch {}
  const entry = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    title: session.title || 'Untitled',
    summary: summary,
    tags: tags,
    project: session.project_name || 'default',
    model: session.model || '',
    agent: session.agent || '',
    filesChanged: (session.summary_files || '').split(',').filter(Boolean).length,
    messageCount: session.message_count || 0,
    cost: session.cost || 0,
    timeCreated: session.time_created,
    timeUpdated: Date.now(),
    notes: ''
  };
  knowledge.entries.unshift(entry);
  saveKnowledge(knowledge);
  return entry;
}

function extractAllKnowledge() {
  const sessions = getSessions('', { limit: 500 });
  let count = 0;
  for (const s of sessions) {
    if (extractKnowledgeFromSession(s.id)) count++;
  }
  return count;
}

function parseCookies(req) {
  const c = {};
  if (req.headers['cookie']) {
    req.headers['cookie'].split(';').forEach(function(pair) {
      var parts = pair.trim().split('=');
      c[parts[0]] = parts.slice(1).join('=');
    });
  }
  return c;
}

function loadAuth() {
  try { if (fs.existsSync(AUTH_FILE)) return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')); } catch {}
  const def = { username: 'admin', password: 'admin123' };
  fs.writeFileSync(AUTH_FILE, JSON.stringify(def, null, 2));
  return def;
}
function checkAuth(req) {
  var ah = req.headers['authorization'] || '';
  var token = ah.startsWith('Bearer ') ? ah.slice(7) : '';
  if (token && _tokens.has(token)) return true;
  var cookies = parseCookies(req);
  var ct = cookies['myd-token'];
  return ct && _tokens.has(ct);
}
function requireAuth(req, res) {
  if (!checkAuth(req)) { res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return false; }
  return true;
}

let htmlCache = null;
function getHTML() {
  if (!htmlCache) htmlCache = fs.readFileSync(HTML_FILE, 'utf-8');
  return htmlCache;
}
function clearHTMLCache() { htmlCache = null; }

var LOGIN_LOG_FILE = path.join(__dirname, 'login-log.json');
function logLogin(req, success) {
  try {
    var log = [];
    if (fs.existsSync(LOGIN_LOG_FILE)) {
      log = JSON.parse(fs.readFileSync(LOGIN_LOG_FILE, 'utf-8'));
    }
    log.push({
      time: Date.now(),
      ip: req.socket.remoteAddress || 'unknown',
      ua: (req.headers['user-agent'] || 'unknown').substring(0, 200),
      success: success
    });
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(LOGIN_LOG_FILE, JSON.stringify(log, null, 2));
  } catch {}
}

function getPipelineStatus() {
  var now = Date.now();
  var AGENTSMD = path.join(process.env.USERPROFILE, '.config', 'opencode', 'AGENTS.md');
  var DISCORD_CFG = path.join(process.env.USERPROFILE, '.config', 'opencode-discord-logger', 'config.json');

  // SQLite DB
  var dbOk = false, dbSize = 0, dbAge = 0;
  try { var st = fs.statSync(DB); dbOk = true; dbSize = st.size; dbAge = now - st.mtimeMs; } catch {}

  // OpenCode — DB written within last 10 min = active
  var opencodeActive = dbOk && dbAge < 600000;

  // Dashboard self
  var up = process.uptime();

  // Discord logger config present
  var discordOk = false;
  try { discordOk = fs.existsSync(DISCORD_CFG); } catch {}

  // Tailscale reachable
  var tailscaleOk = false;
  try { execSync('"'+TAILSCALE_BIN+'" status', { windowsHide: true, timeout: 2000 }); tailscaleOk = true; } catch {}

  // AGENTS.md
  var agentsOk = false, agentsAge = 0;
  try { var am = fs.statSync(AGENTSMD); agentsOk = true; agentsAge = now - am.mtimeMs; } catch {}

  return {
    timestamp: now,
    components: [
      { id:'opencode', label:'OpenCode CLI', status: opencodeActive ? 'green' : 'yellow', metrics: { 'Last activity': opencodeActive ? '<1m' : '>10m ago' } },
      { id:'sqlite', label:'SQLite DB', status: dbOk ? 'green' : 'red', metrics: dbOk ? { 'Size': (dbSize/1024/1024).toFixed(1)+' MB', 'Age': Math.floor(dbAge/1000)+'s' } : { 'Status': 'missing' } },
      { id:'dashboard', label:'Dashboard', status: 'green', metrics: { 'Uptime': Math.floor(up/60)+'m', 'PID': process.pid } },
      { id:'safari', label:'iPhone Safari', status: 'green', metrics: { 'Via': 'Tailscale :3344' } },
      { id:'discord', label:'Discord Logger', status: discordOk ? 'green' : 'yellow', metrics: discordOk ? { 'Config': '✓' } : { 'Config': 'not found' } },
      { id:'tailscale', label:'Tailscale', status: tailscaleOk ? 'green' : 'red', metrics: { 'IP': '100.70.19.81' } },
      { id:'agentsmd', label:'AGENTS.md', status: agentsOk ? 'green' : 'red', metrics: agentsOk ? { 'Age': Math.floor(agentsAge/60000)+'m' } : { 'Status': 'missing' } },
      { id:'gist', label:'GitHub Gist', status: agentsOk ? 'green' : 'yellow', metrics: { 'Sync': 'auto' } }
    ],
    edges: [
      { from:'opencode', to:'sqlite' },
      { from:'sqlite', to:'dashboard' },
      { from:'dashboard', to:'safari' },
      { from:'opencode', to:'discord' },
      { from:'agentsmd', to:'gist' },
      { from:'tailscale', to:'dashboard' }
    ]
  };
}

function getDiagInfo() {
  var now = Date.now();
  var info = { time: now, uptime: process.uptime(), pid: process.pid, memory: process.memoryUsage(), node: process.version };
  try { info.dbSize = fs.statSync(DB).size; } catch {}
  try { info.dbModified = fs.statSync(DB).mtimeMs; } catch {}
  try { var r = execSync('tasklist /FI "IMAGENAME eq opencode.exe" /NH', { windowsHide: true, timeout: 3000, encoding: 'utf-8' }); info.opencodeProcess = r.includes('opencode.exe'); } catch { info.opencodeProcess = false; }
  try { execSync('"'+TAILSCALE_BIN+'" status', { windowsHide: true, timeout: 3000 }); info.tailscale = true; } catch { info.tailscale = false; }
  return info;
}

var loginHTMLCache = null;
var LOGIN_FILE = path.join(__dirname, 'login.html');
function getLoginHTML() {
  if (!loginHTMLCache) loginHTMLCache = fs.readFileSync(LOGIN_FILE, 'utf-8');
  return loginHTMLCache;
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
    const out = execSync('"' + SQLITE + '" -json "' + DB + '"', {
      input: q, encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, windowsHide: true, timeout: 15000
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
    execSync('"' + SQLITE + '" "' + DB + '"', {
      input: q, encoding: 'utf-8',
      windowsHide: true, timeout: 10000
    });
    return true;
  } catch (e) {
    throw new Error(e.message.substring(0, 300));
  }
}

function esc(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/'/g, "''");
}

// === SESSIONS ===
function getSessions(search, opts = {}) {
  let conditions = [];
  if (search) {
    const s = esc(search);
    conditions.push("(s.title LIKE '%" + s + "%' OR s.model LIKE '%" + s + "%' OR s.agent LIKE '%" + s + "%' OR json_extract(s.metadata, '$.tags') LIKE '%" + s + "%')");
  }
  if (opts.model) conditions.push("s.model LIKE '%" + esc(opts.model) + "%'");
  if (opts.agent) conditions.push("s.agent LIKE '%" + esc(opts.agent) + "%'");
  if (opts.project) conditions.push("s.project_id = '" + esc(opts.project) + "'");
  if (opts.bookmarked) conditions.push("json_extract(s.metadata, '$.bookmarked') = 'true'");
  if (opts.tag) conditions.push("json_extract(s.metadata, '$.tags') LIKE '%\"" + esc(opts.tag) + "\"%'");
  if (opts.dateFrom) conditions.push("s.time_created >= " + parseInt(opts.dateFrom, 10));
  if (opts.dateTo) conditions.push("s.time_created <= " + parseInt(opts.dateTo, 10));
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const limit = parseInt(opts.limit, 10) || 200;
  return sql("SELECT s.id, s.title, s.time_created, s.time_updated,"
    + " datetime(s.time_created/1000,'unixepoch','localtime') as created_at,"
    + " datetime(s.time_updated/1000,'unixepoch','localtime') as updated_at,"
    + " s.model, s.agent, s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,"
    + " s.directory, s.project_id,"
    + " json_extract(s.metadata, '$.bookmarked') as bookmarked,"
    + " json_extract(s.metadata, '$.tags') as tags,"
    + " s.summary_files, s.summary_additions, s.summary_deletions,"
    + " (SELECT p.name FROM project p WHERE p.id = s.project_id) as project_name,"
    + " (SELECT w.name FROM workspace w WHERE w.id = s.workspace_id) as workspace_name,"
    + " (SELECT w.branch FROM workspace w WHERE w.id = s.workspace_id) as branch,"
    + " (SELECT COUNT(*) FROM message WHERE session_id = s.id) as message_count,"
    + " (SELECT COUNT(*) FROM todo WHERE session_id = s.id) as todo_count,"
    + " (SELECT COUNT(*) FROM todo WHERE session_id = s.id AND status = 'completed') as todos_done,"
    + " (SELECT substr(json_extract(p.data,'$.text'),1,120) FROM part p JOIN message m2 ON m2.id = p.message_id WHERE m2.session_id = s.id AND json_extract(m2.data,'$.role') = 'user' AND json_extract(p.data,'$.type') = 'text' ORDER BY m2.time_created ASC LIMIT 1) as message_preview"
    + " FROM session s" + where + " ORDER BY s.time_created DESC LIMIT " + limit);
}

function getSession(sessionId) {
  return sql("SELECT s.id, s.title, s.time_created,"
    + " datetime(s.time_created/1000,'unixepoch','localtime') as created_at,"
    + " datetime(s.time_updated/1000,'unixepoch','localtime') as updated_at,"
    + " s.model, s.agent, s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,"
    + " s.directory, s.project_id, s.summary_files, s.summary_additions, s.summary_deletions,"
    + " json_extract(s.metadata, '$.bookmarked') as bookmarked,"
    + " json_extract(s.metadata, '$.tags') as tags,"
    + " (SELECT p.name FROM project p WHERE p.id = s.project_id) as project_name,"
    + " (SELECT w.name FROM workspace w WHERE w.id = s.workspace_id) as workspace_name,"
    + " (SELECT w.branch FROM workspace w WHERE w.id = s.workspace_id) as branch,"
    + " (SELECT COUNT(*) FROM todo WHERE session_id = s.id) as todo_count,"
    + " (SELECT COUNT(*) FROM todo WHERE session_id = s.id AND status = 'completed') as todos_done"
    + " FROM session s WHERE s.id = :id LIMIT 1", { id: sessionId })[0] || null;
}

function getMessages(sessionId, opts = {}) {
  const limit = parseInt(opts.limit) || 0;
  const offset = parseInt(opts.offset) || 0;
  const base = "SELECT m.time_created as msg_time,"
    + " json_extract(m.data, '$.role') as role,"
    + " json_extract(p.data, '$.type') as part_type,"
    + " json_extract(p.data, '$.text') as text,"
    + " json_extract(p.data, '$.state.input.command') as command,"
    + " json_extract(p.data, '$.state.output') as output,"
    + " json_extract(p.data, '$.state.metadata.exit') as exit_code,"
    + " json_extract(p.data, '$.state.input.description') as cmd_description,"
    + " json_extract(p.data, '$.tool') as tool_name,"
    + " p.time_created as part_time, p.id as part_id"
    + " FROM message m JOIN part p ON p.message_id = m.id"
    + " WHERE m.session_id = :sid"
    + " AND json_extract(p.data, '$.type') IN ('text','tool','tool-result','reasoning')";
  if (limit > 0) {
    const rows = sql(base + " ORDER BY m.time_created DESC, p.time_created DESC LIMIT " + limit + " OFFSET " + offset, { sid: sessionId });
    return rows.reverse();
  }
  return sql(base + " ORDER BY m.time_created, p.time_created", { sid: sessionId });
}
function getTotalParts(sessionId) {
  return sql("SELECT COUNT(*) as c FROM part p JOIN message m ON p.message_id = m.id WHERE m.session_id = :sid", { sid: sessionId })[0]?.c || 0;
}

// === STATS ===
function getSessionStats() {
  return sql("SELECT"
    + " COUNT(*) as total_sessions,"
    + " COALESCE(SUM(tokens_input), 0) as total_tokens_in,"
    + " COALESCE(SUM(tokens_output), 0) as total_tokens_out,"
    + " COALESCE(SUM(tokens_reasoning), 0) as total_tokens_reasoning,"
    + " COALESCE(SUM(cost), 0) as total_cost,"
    + " COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as total_tokens,"
    + " COALESCE(AVG(cost), 0) as avg_cost,"
    + " COALESCE(MAX(tokens_input + tokens_output + tokens_reasoning), 0) as max_tokens"
    + " FROM session");
}

// === CHARTS ===
function getChartData() {
  const daily30 = sql("SELECT date(time_created/1000,'unixepoch','localtime') as day,"
    + " COUNT(*) as sessions, COALESCE(SUM(cost), 0) as cost,"
    + " COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as tokens,"
    + " COALESCE(SUM(tokens_input), 0) as tokens_in, COALESCE(SUM(tokens_output), 0) as tokens_out,"
    + " COALESCE(SUM(tokens_reasoning), 0) as tokens_reasoning,"
    + " COALESCE(AVG(cost), 0) as avg_cost"
    + " FROM session GROUP BY day ORDER BY day ASC LIMIT 30");
  const weekly = sql("SELECT strftime('%Y-W%W', time_created/1000,'unixepoch','localtime') as week,"
    + " COUNT(*) as sessions, COALESCE(SUM(cost), 0) as cost,"
    + " COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as tokens"
    + " FROM session GROUP BY week ORDER BY week ASC LIMIT 24");
  const hourly = sql("SELECT CAST(strftime('%H', time_created/1000,'unixepoch','localtime') AS INTEGER) as hour,"
    + " COUNT(*) as count FROM session GROUP BY hour ORDER BY hour");
  const modelBreakdown = sql("SELECT COALESCE(model, 'unknown') as name, COUNT(*) as count,"
    + " COALESCE(SUM(cost), 0) as cost, COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as tokens"
    + " FROM session GROUP BY name ORDER BY count DESC");
  return { daily: daily30, weekly, hourly, modelBreakdown };
}

// === HOME STATS ===
function getHomeStats() {
  const totals = getSessionStats()[0] || {};
  const sessionsPerDay = sql("SELECT date(time_created/1000,'unixepoch','localtime') as day,"
    + " COUNT(*) as count, COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as tokens,"
    + " COALESCE(SUM(cost), 0) as cost"
    + " FROM session GROUP BY day ORDER BY day DESC LIMIT 30");
  const modelDist = sql("SELECT COALESCE(model, 'unknown') as name, COUNT(*) as count,"
    + " COALESCE(SUM(tokens_input + tokens_output + tokens_reasoning), 0) as tokens"
    + " FROM session GROUP BY name ORDER BY count DESC LIMIT 20");
  const agentDist = sql("SELECT COALESCE(agent, 'unknown') as name, COUNT(*) as count"
    + " FROM session GROUP BY name ORDER BY count DESC LIMIT 20");
  const totalTodos = sql("SELECT COUNT(*) as total,"
    + " COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END), 0) as done,"
    + " COALESCE(SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END), 0) as in_progress"
    + " FROM todo")[0] || {};
  const totalMessages = sql("SELECT COUNT(*) as count FROM part")[0] || {};
  const activeProjects = sql("SELECT COUNT(DISTINCT project_id) as count FROM session")[0] || {};
  const recentActivity = sql("SELECT s.id, s.title, s.time_created,"
    + " datetime(s.time_created/1000,'unixepoch','localtime') as created_at,"
    + " s.model, s.agent, s.directory,"
    + " json_extract(s.metadata, '$.tags') as tags,"
    + " (SELECT p.name FROM project p WHERE p.id = s.project_id) as project_name"
    + " FROM session s ORDER BY s.time_created DESC LIMIT 10");
  return {
    totals, sessionsPerDay, modelDist, agentDist, totalTodos,
    totalMessages: totalMessages.count || 0,
    activeProjects: activeProjects.count || 0,
    recentActivity
  };
}

// === PROJECTS ===
function getProjects() {
  return sql("SELECT p.id, p.name, p.worktree, p.vcs,"
    + " COUNT(s.id) as session_count,"
    + " COALESCE(SUM(s.tokens_input + s.tokens_output + s.tokens_reasoning), 0) as total_tokens,"
    + " COALESCE(SUM(s.cost), 0) as total_cost,"
    + " MAX(s.time_created) as last_session_time,"
    + " datetime(MAX(s.time_created)/1000,'unixepoch','localtime') as last_session_at"
    + " FROM project p LEFT JOIN session s ON s.project_id = p.id"
    + " GROUP BY p.id ORDER BY last_session_time DESC");
}

// === SEARCH ===
function searchAll(query) {
  const q = esc(query);
  return sql("SELECT DISTINCT s.id, s.title, s.time_created,"
    + " datetime(s.time_created/1000,'unixepoch','localtime') as created_at,"
    + " s.model, s.agent,"
    + " (SELECT COUNT(*) FROM message WHERE session_id = s.id) as message_count,"
    + " (SELECT p.name FROM project p WHERE p.id = s.project_id) as project_name,"
    + " substr(COALESCE(json_extract(p.data, '$.text'), ''), 1, 200) as match_preview"
    + " FROM session s"
    + " JOIN message m ON m.session_id = s.id"
    + " JOIN part p ON p.message_id = m.id"
    + " WHERE json_extract(p.data, '$.text') LIKE '%" + q + "%'"
    + " ORDER BY s.time_created DESC LIMIT 100");
}

// === FILE CHANGES ===
function getFileChanges(sessionId) {
  const raw = sql("SELECT p.data FROM part p"
    + " JOIN message m ON p.message_id = m.id"
    + " WHERE m.session_id = :sid"
    + " AND json_extract(p.data, '$.type') = 'tool'"
    + " AND json_extract(p.data, '$.text') IS NOT NULL"
    + " ORDER BY p.time_created", { sid: sessionId });
  const files = new Map();
  for (const row of raw) {
    let text = '';
    try { text = JSON.parse(row.data).text || ''; } catch { text = row.data || ''; }
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/(?:Write|Edit|Read|Create|Delete|Move|Copy)\s+(?:file|to|from)?\s*["`']?([^"`'\n]+)["`']?/i);
      if (match) {
        const fp = match[1].trim();
        if (fp && !fp.startsWith('http')) {
          files.set(fp, (files.get(fp) || 0) + 1);
        }
      }
    }
  }
  return Array.from(files.entries()).map(([f, c]) => ({ file: f, count: c }));
}

// === FILE EXPLORER (global) ===
function getFileExplorer() {
  const sessions = sql("SELECT id, title, time_created, datetime(time_created/1000,'unixepoch','localtime') as created_at FROM session ORDER BY time_created DESC LIMIT 100");
  const allFiles = [];
  for (const s of sessions) {
    const files = getFileChanges(s.id);
    if (files.length) {
      allFiles.push({ sessionId: s.id, sessionTitle: s.title, sessionDate: s.created_at, files });
    }
  }
  const extMap = {};
  const dirMap = {};
  const flatFiles = [];
  for (const entry of allFiles) {
    for (const f of entry.files) {
      flatFiles.push({ file: f.file, count: f.count, sessionId: entry.sessionId, sessionTitle: entry.sessionTitle });
      const ext = path.extname(f.file).toLowerCase() || '(no ext)';
      extMap[ext] = (extMap[ext] || 0) + 1;
      const dir = path.dirname(f.file);
      if (dir !== '.') {
        const top = dir.split(/[/\\]/)[0];
        dirMap[top] = (dirMap[top] || 0) + 1;
      }
    }
  }
  return { bySession: allFiles, byExt: extMap, byDir: dirMap, allFiles: flatFiles.slice(0, 500) };
}

// === MEMORY LOG ===
function getMemoryLog() {
  const agentsPath = path.join(process.env.USERPROFILE, '.config', 'opencode', 'AGENTS.md');
  try {
    if (!fs.existsSync(agentsPath)) return [];
    const content = fs.readFileSync(agentsPath, 'utf-8');
    const parts = content.split('## Memory Log');
    const memSection = parts.length > 1 ? parts[parts.length - 1] : '';
    const entries = [];
    const regex = /^- (\d{4}-\d{2}-\d{2}): (.+)$/gm;
    let match;
    while ((match = regex.exec(memSection)) !== null) {
      entries.push({ date: match[1], text: match[2].trim() });
    }
    return entries;
  } catch (e) {
    return [];
  }
}

function getSessionMemory(sessionId) {
  const session = getSession(sessionId);
  if (!session) return [];
  const sessionDate = session.created_at ? session.created_at.substring(0, 10) : '';
  if (!sessionDate) return [];
  const entries = getMemoryLog();
  return entries.filter(e => e.date === sessionDate);
}

function getAllMemoryWithSessions() {
  const entries = getMemoryLog();
  const sessions = sql("SELECT s.id, s.title, s.time_created, datetime(s.time_created/1000,'unixepoch','localtime') as created_at FROM session s ORDER BY s.time_created DESC");
  return entries.map(e => {
    const matched = sessions.filter(s => s.created_at && s.created_at.substring(0, 10) === e.date);
    return { ...e, sessions: matched.slice(0, 20) };
  });
}

// === TODOS ===
function getTodos(sessionId, status) {
  let where = '';
  if (sessionId) where += " WHERE t.session_id = '" + esc(sessionId) + "'";
  if (status) {
    where += (where ? " AND" : " WHERE") + " t.status = '" + esc(status) + "'";
  }
  return sql("SELECT t.session_id, t.content, t.status, t.priority, t.position,"
    + " t.time_created, t.time_updated,"
    + " datetime(t.time_created/1000,'unixepoch','localtime') as created_at,"
    + " s.title as session_title"
    + " FROM todo t LEFT JOIN session s ON s.id = t.session_id" + where
    + " ORDER BY t.time_created DESC LIMIT 500");
}

function deleteSession(sessionId) {
  sqlExec("DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id = :sid)", { sid: sessionId });
  sqlExec("DELETE FROM message WHERE session_id = :sid", { sid: sessionId });
  sqlExec("DELETE FROM session WHERE id = :sid", { sid: sessionId });
  return true;
}

function renameSession(sessionId, title) {
  sqlExec("UPDATE session SET title = :title WHERE id = :sid", { sid: sessionId, title: title });
  return true;
}

function bookmarkSession(sessionId, bookmarked) {
  const val = bookmarked ? 'true' : 'false';
  sqlExec("UPDATE session SET metadata = json_set(COALESCE(metadata, '{}'), '$.bookmarked', " + val + ") WHERE id = :sid", { sid: sessionId });
  return true;
}

// === TAGS ===
function getSessionTags(sessionId) {
  const s = getSession(sessionId);
  if (!s || !s.tags) return [];
  try { return JSON.parse(s.tags); } catch { return []; }
}

function setSessionTags(sessionId, tags) {
  const tagsStr = JSON.stringify(tags || []);
  sqlExec("UPDATE session SET metadata = json_set(COALESCE(metadata, '{}'), '$.tags', json('" + esc(tagsStr) + "')) WHERE id = :sid", { sid: sessionId });
  return true;
}

function getAllTags() {
  const rows = sql("SELECT DISTINCT json_extract(s.metadata, '$.tags') as tags FROM session s WHERE json_extract(s.metadata, '$.tags') IS NOT NULL");
  const all = new Set();
  for (const r of rows) {
    if (!r.tags) continue;
    try { JSON.parse(r.tags).forEach(t => all.add(t)); } catch {}
  }
  return Array.from(all).sort();
}

// === HEALTH SCORE ===
function getHealthScore(sessionId) {
  const s = getSession(sessionId);
  if (!s) return null;
  const msgs = getMessages(sessionId);
  const totalTokens = (s.tokens_input || 0) + (s.tokens_output || 0) + (s.tokens_reasoning || 0);
  const msgCount = msgs.length || 1;
  const userMsgs = msgs.filter(m => m.role === 'user').length || 1;
  const costPerMsg = s.cost ? (s.cost / msgCount) : 0;
  const tokensPerMsg = totalTokens / msgCount;
  const reasoningRatio = totalTokens > 0 ? ((s.tokens_reasoning || 0) / totalTokens) : 0;
  const efficiency = totalTokens > 0 ? (s.tokens_output / totalTokens) : 0;
  const score = Math.round(100 - (reasoningRatio * 30) - (costPerMsg > 0.01 ? 20 : 0) + (efficiency * 20));
  return {
    score: Math.max(0, Math.min(100, score)),
    totalTokens, msgCount, userMsgs: userMsgs,
    costPerMsg, tokensPerMsg: Math.round(tokensPerMsg),
    reasoningRatio: Math.round(reasoningRatio * 100),
    efficiency: Math.round(efficiency * 100),
    cost: s.cost || 0,
    tokensIn: s.tokens_input || 0,
    tokensOut: s.tokens_output || 0,
    tokensReasoning: s.tokens_reasoning || 0
  };
}

// === COMPARE SESSIONS ===
function compareSessions(id1, id2) {
  const s1 = getSession(id1);
  const s2 = getSession(id2);
  if (!s1 || !s2) return null;
  const h1 = getHealthScore(id1);
  const h2 = getHealthScore(id2);
  const msgs1 = getMessages(id1);
  const msgs2 = getMessages(id2);
  return {
    a: { session: s1, health: h1, msgCount: msgs1.length, todos: (s1.todo_count || 0) },
    b: { session: s2, health: h2, msgCount: msgs2.length, todos: (s2.todo_count || 0) },
    diff: {
      cost: ((s2.cost || 0) - (s1.cost || 0)).toFixed(6),
      tokens: ((s2.tokens_input || 0) + (s2.tokens_output || 0)) - ((s1.tokens_input || 0) + (s1.tokens_output || 0)),
      messages: msgs2.length - msgs1.length,
      health: (h2 ? h2.score : 50) - (h1 ? h1.score : 50)
    }
  };
}

// === GIT COMMITS ===
function getGitCommits(limit = 20) {
  const projects = sql("SELECT DISTINCT p.id, p.name, p.worktree, p.vcs FROM project p WHERE p.vcs IS NOT NULL LIMIT 10");
  const allCommits = [];
  for (const proj of projects) {
    if (!proj.worktree || !fs.existsSync(proj.worktree)) continue;
    try {
      const log = execSync('git log --oneline -10 --date=short --format="%h|%ad|%s"', {
        cwd: proj.worktree, encoding: 'utf-8', timeout: 5000, windowsHide: true
      }).trim();
      if (!log) continue;
      const lines = log.split('\n');
      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 3) {
          allCommits.push({
            project: proj.name || proj.id.substring(0, 12),
            hash: parts[0], date: parts[1], message: parts.slice(2).join('|')
          });
        }
      }
    } catch {}
    if (allCommits.length >= limit) break;
  }
  return allCommits.slice(0, limit);
}

// === AI SUMMARY ===
function getAISummary(sessionId) {
  try {
    const model = execSync('ollama list', { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
    const lines = model.split('\n');
    if (lines.length < 2) return null;
    const firstModel = lines[1].split(/\s+/)[0];
    if (!firstModel) return null;
    const msgs = getMessages(sessionId);
    const session = getSession(sessionId);
    const text = msgs.filter(m => m.role !== 'tool' && m.part_type !== 'tool-result').map(m => (m.text || '')).join('\n').substring(0, 3000);
    if (!text) return null;
    const prompt = 'Summarize this AI coding session in 2-3 sentences. Title: ' + (session.title || 'Untitled') + '\n\n' + text;
    const safePrompt = prompt.replace(/"/g, '\\"').replace(/`/g, '\\`');
    const result = execSync('ollama run ' + firstModel + ' "' + safePrompt.substring(0, 2000) + '"', {
      encoding: 'utf-8', timeout: 30000, windowsHide: true
    }).trim();
    return { model: firstModel, summary: result.substring(0, 500) };
  } catch { return null; }
}

// === SETTINGS ===
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {}
  return { accentColor: '#10a37f', chartStyle: 'bar', homeLayout: 'default' };
}

function setSettings(data) {
  const cur = getSettings();
  const merged = { ...cur, ...data };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

// === PWA ===
function getManifest() {
  return {
    name: 'My AI Dashboard', short_name: 'My AI',
    start_url: '/', display: 'standalone', background_color: '#212121', theme_color: '#10a37f',
    icons: [{ src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🤖</text></svg>', sizes: '192x192', type: 'image/svg+xml' }]
  };
}

// === EXPORT ===
function exportSession(sessionId, format) {
  const session = getSession(sessionId);
  if (!session) return null;
  const msgs = getMessages(sessionId);
  const todos = getTodos(sessionId);
  const files = getFileChanges(sessionId);
  const health = getHealthScore(sessionId);
  if (format === 'json') {
    return JSON.stringify({ session, messages: msgs, todos, fileChanges: files, health }, null, 2);
  }
  let md = "# " + (session.title || 'Untitled') + "\n\n";
  md += "**Model:** " + (session.model || 'N/A') + " | ";
  md += "**Date:** " + (session.created_at || 'N/A') + "\n\n";
  if (session.project_name) md += "**Project:** " + session.project_name + "\n\n";
  if (health) md += "**Health Score:** " + health.score + "/100\n\n";
  if (files.length) {
    md += "## Files Changed\n\n";
    for (const f of files) md += "- " + f.file + "\n";
    md += "\n---\n\n";
  }
  if (todos.length) {
    md += "## Tasks\n\n";
    for (const t of todos) {
      md += "- [" + (t.status === 'completed' ? 'x' : ' ') + "] " + t.content + "\n";
    }
    md += "\n---\n\n";
  }
  for (const m of msgs) {
    const role = m.role === 'user' ? '**You**' : (m.role === 'tool' ? '**Tool**' : '**Assistant**');
    const type = m.part_type || 'text';
    if (type === 'reasoning') continue;
    md += role + ":\n\n";
    if (type === 'tool' || type === 'tool-result') {
      md += "```\n" + (m.text || '') + "\n```\n\n";
    } else {
      md += (m.text || '') + "\n\n";
    }
  }
  if (format === 'markdown') return md;
  let txt = session.title || 'Untitled';
  txt += "\nModel: " + (session.model || 'N/A') + "\n\n";
  for (const m of msgs) {
    const role = m.role === 'user' ? 'You' : (m.role === 'tool' ? 'Tool' : 'Assistant');
    const type = m.part_type || 'text';
    if (type === 'reasoning') continue;
    txt += "--- " + role + " ---\n";
    txt += (m.text || '') + "\n\n";
  }
  return txt;
}

function exportAll(format) {
  const sessions = getSessions('', {});
  const result = [];
  for (const s of sessions) {
    result.push(exportSession(s.id, format === 'json' ? 'json' : 'text'));
  }
  if (format === 'json') return '[' + result.join(',') + ']';
  return result.join('\n\n' + '='.repeat(60) + '\n\n');
}

// === CHAT ===
function getChat() {
  try { if (fs.existsSync(CHAT_FILE)) return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf-8')); } catch {}
  return [];
}
function addChatMessage(msg) {
  const chat = getChat();
  msg.id = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  msg.timestamp = Date.now();
  chat.push(msg);
  fs.writeFileSync(CHAT_FILE, JSON.stringify(chat, null, 2));
  return msg;
}

function maybeGzip(req, res, data, hdrs) {
  const accept = (req.headers['accept-encoding'] || '').toLowerCase();
  if (accept.includes('gzip') && data.length > 1024) {
    const buf = zlib.gzipSync(data);
    hdrs['Content-Encoding'] = 'gzip';
    res.writeHead(hdrs.status || 200, hdrs); res.end(buf);
    return true;
  }
  res.writeHead(hdrs.status || 200, hdrs); res.end(data);
  return false;
}

function json(req, res, data, status = 200) {
  const str = JSON.stringify(data);
  maybeGzip(req, res, str, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', status });
}

function sendFile(req, res, content, type, status = 200) {
  maybeGzip(req, res, content, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', status });
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); return; } catch {}
      try {
        var params = {};
        body.split('&').forEach(function(pair) {
          if (!pair) return;
          var parts = pair.split('=');
          var k = decodeURIComponent(parts[0].replace(/\+/g, ' '));
          var v = decodeURIComponent((parts.slice(1).join('=')).replace(/\+/g, ' '));
          params[k] = v;
        });
        resolve(params);
      } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;

    // Login endpoint (no auth required)
    if (pathname === '/api/login' && method === 'POST') {
      const body = await parseBody(req);
      const auth = loadAuth();
      const ok = body.username === auth.username && body.password === auth.password;
      logLogin(req, ok);
      if (ok) {
        const token = crypto.randomUUID();
        _tokens.add(token);
        res.setHeader('Set-Cookie', 'myd-token=' + token + '; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/');
        json(req, res, { token });
      } else {
        json(req, res, { error: 'Invalid credentials' }, 401);
      }
      return;
    }
    if (pathname === '/api/logout' && method === 'POST') {
      var ah = req.headers['authorization'] || '';
      var token = ah.startsWith('Bearer ') ? ah.slice(7) : '';
      if (!token) { var cookies = parseCookies(req); token = cookies['myd-token'] || ''; }
      _tokens.delete(token);
      res.setHeader('Set-Cookie', 'myd-token=; Path=/; Max-Age=0');
      json(req, res, { success: true });
      return;
    }

    // Protect all /api/ routes
    if (pathname.startsWith('/api/') && !checkAuth(req)) {
      json(req, res, { error: 'Unauthorized' }, 401);
      return;
    }

    if (pathname === '/' || pathname === '/dashboard') {
      if (checkAuth(req)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getHTML());
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getLoginHTML());
      }

    } else if (pathname === '/api/home') {
      json(req, res, getHomeStats());

    } else if (pathname === '/api/charts') {
      json(req, res, getChartData());

    } else if (pathname === '/api/projects') {
      json(req, res, getProjects());

    } else if (pathname === '/api/repos') {
      const repos = [
        { name: 'my-ai-dashboard', url: 'https://github.com/sarthhkkk/my-ai-dashboard', description: 'Zero-dependency AI chat dashboard for browsing SQLite session logs' },
        { name: 'android-task-automator', url: 'https://github.com/sarthhkkk/android-task-automator', description: 'Extensible Android automation framework powered by uiautomator2' },
        { name: 'opencode-discord-logger', url: 'https://github.com/sarthhkkk/opencode-discord-logger', description: 'Log every OpenCode AI chat session to Discord via webhook' },
        { name: 'selfy', url: 'https://github.com/sarthhkkk/selfy', description: 'Unique Selfie Prompt Generation Tool' },
        { name: '99acres-scraper', url: 'https://github.com/sarthhkkk/99acres-scraper', description: '99acres scraper: Chrome extension + Python Playwright + Discord logger' },
        { name: 'quickshare-pwa', url: 'https://github.com/sarthhkkk/quickshare-pwa', description: 'Progressive Web App for instant P2P file sharing between devices' }
      ];
      json(req, res, repos);

    } else if (pathname === '/api/search-all' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      if (!q) { json(req, res, []); return; }
      json(req, res, searchAll(q));

    } else if (pathname === '/api/sessions' && method === 'GET') {
      const search = url.searchParams.get('q') || '';
      const model = url.searchParams.get('model') || '';
      const agent = url.searchParams.get('agent') || '';
      const project = url.searchParams.get('project') || '';
      const bookmarked = url.searchParams.get('bookmarked') || '';
      const tag = url.searchParams.get('tag') || '';
      const dateFrom = url.searchParams.get('dateFrom') || '';
      const dateTo = url.searchParams.get('dateTo') || '';
      const limit = url.searchParams.get('limit') || '';
      json(req, res, getSessions(search, { model, agent, project, bookmarked, tag, dateFrom, dateTo, limit }));

    } else if (pathname === '/api/all-tags') {
      json(req, res, getAllTags());

    } else if (pathname === '/api/stats') {
      json(req, res, getSessionStats()[0] || {});

    } else if (pathname === '/api/todos' && method === 'GET') {
      const status = url.searchParams.get('status') || '';
      json(req, res, getTodos(null, status));

    } else if (pathname.startsWith('/api/file-changes/')) {
      const id = pathname.slice('/api/file-changes/'.length);
      json(req, res, getFileChanges(id));

    } else if (pathname === '/api/file-explorer') {
      json(req, res, getFileExplorer());

    } else if (pathname === '/api/git-commits') {
      json(req, res, getGitCommits());

    } else if (pathname.startsWith('/api/health/')) {
      const id = pathname.slice('/api/health/'.length);
      json(req, res, getHealthScore(id));

    } else if (pathname === '/api/compare') {
      const s1 = url.searchParams.get('a');
      const s2 = url.searchParams.get('b');
      if (!s1 || !s2) { json(req, res, { error: 'Need ?a=id1&b=id2' }, 400); return; }
      json(req, res, compareSessions(s1, s2));

    } else if (pathname.startsWith('/api/tags/') && method === 'PATCH') {
      const id = pathname.slice('/api/tags/'.length);
      const body = await parseBody(req);
      if (body.tags !== undefined) { setSessionTags(id, body.tags); json(req, res, { success: true }); }
      else { json(req, res, { error: 'No tags field' }, 400); }

    } else if (pathname.startsWith('/api/tags/') && method === 'GET') {
      const id = pathname.slice('/api/tags/'.length);
      json(req, res, getSessionTags(id));

    } else if (pathname.startsWith('/api/ai-summary/')) {
      const id = pathname.slice('/api/ai-summary/'.length);
      const summary = getAISummary(id);
      if (summary) json(req, res, summary);
      else json(req, res, { error: 'No model available. Run: ollama pull <model>' }, 400);

    } else if (pathname === '/api/settings' && method === 'GET') {
      json(req, res, getSettings());

    } else if (pathname === '/api/settings' && method === 'PATCH') {
      const body = await parseBody(req);
      json(req, res, setSettings(body));

    } else if (pathname.startsWith('/api/todos/')) {
      const id = pathname.slice('/api/todos/'.length);
      json(req, res, getTodos(id));

    } else if (pathname === '/api/memory') {
      json(req, res, getMemoryLog());

    } else if (pathname === '/api/memory-all') {
      json(req, res, getAllMemoryWithSessions());

    } else if (pathname.startsWith('/api/session-memory/')) {
      const id = pathname.slice('/api/session-memory/'.length);
      json(req, res, getSessionMemory(id));

    } else if (pathname === '/api/export-all') {
      const format = url.searchParams.get('format') || 'json';
      const data = exportAll(format);
      const cts = { 'json': 'application/json', 'text': 'text/plain' };
      res.writeHead(200, { 'Content-Type': cts[format] || 'text/plain', 'Content-Disposition': 'attachment; filename="opencode-export.' + format + '"' });
      res.end(data);

    } else if (pathname.startsWith('/api/export/')) {
      const rest = pathname.slice('/api/export/'.length);
      const format = url.searchParams.get('format') || 'json';
      const id = rest.replace(/\/[^/]+$/, '');
      const data = exportSession(id, format);
      if (data === null) { json(req, res, { error: 'Not found' }, 404); return; }
      const cts = { 'json': 'application/json', 'markdown': 'text/markdown', 'text': 'text/plain' };
      res.writeHead(200, { 'Content-Type': cts[format] || 'text/plain' });
      res.end(data);

    } else if (pathname.startsWith('/api/session/') && method === 'DELETE') {
      const id = pathname.slice('/api/session/'.length);
      deleteSession(id);
      json(req, res, { success: true });

    } else if (pathname.startsWith('/api/session/') && method === 'PATCH') {
      const id = pathname.slice('/api/session/'.length);
      const body = await parseBody(req);
      if (body.title !== undefined) { renameSession(id, body.title); json(req, res, { success: true }); }
      else if (body.bookmarked !== undefined) { bookmarkSession(id, body.bookmarked); json(req, res, { success: true }); }
      else { json(req, res, { error: 'No title or bookmarked field' }, 400); }

    } else if (pathname.startsWith('/api/session/')) {
      const id = pathname.slice('/api/session/'.length);
      json(req, res, getSession(id));

    } else if (pathname.startsWith('/api/messages/')) {
      const id = pathname.slice('/api/messages/'.length);
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      const limit = parseInt(url.searchParams.get('limit')) || 0;
      if (limit > 0) {
        json(req, res, { messages: getMessages(id, { offset, limit }), total_parts: getTotalParts(id) });
      } else {
        json(req, res, getMessages(id));
      }

    } else if (pathname === '/manifest.json') {
      sendFile(req, res, JSON.stringify(getManifest()), 'application/json');

    } else if (pathname === '/sw.js') {
      const sw = 'self.addEventListener("fetch",function(e){e.respondWith(fetch(e.request).catch(function(){return new Response("Offline",{status:503})}))});';
      sendFile(req, res, sw, 'application/javascript');

    } else if (pathname === '/api/chat' && method === 'GET') {
      json(req, res, getChat());

    } else if (pathname === '/api/chat' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.text && !body.image) { json(req, res, { error: 'Need text or image' }, 400); return; }
      let image = body.image || null;
      if (image && image.startsWith('data:image')) {
        const matches = image.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'png' ? 'png' : 'jpg';
          const fname = 'chat_' + Date.now() + '.' + ext;
          const dir = path.join(__dirname, 'uploads');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir);
          fs.writeFileSync(path.join(dir, fname), Buffer.from(matches[2], 'base64'));
          image = '/uploads/' + fname;
        }
      }
      const msg = addChatMessage({ role: 'user', text: body.text || '', image });
      json(req, res, msg);

    } else if (pathname === '/api/uploads') {
      const dir = path.join(__dirname, 'uploads');
      let files = [];
      try {
        if (fs.existsSync(dir)) files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).map(f => ({ name: f, url: '/uploads/' + f, time: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.time - a.time);
      } catch {}
      json(req, res, files);

    } else if (pathname === '/upload') {
      if (!checkAuth(req)) { json(req, res, { error: 'Unauthorized' }, 401); return; }
      if (method === 'POST') {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', () => {
          const buf = Buffer.concat(body);
          const boundary = req.headers['content-type'].split('boundary=')[1];
          if (!boundary) { res.writeHead(400); res.end('Bad request'); return; }
          const parts = buf.toString('binary').split('--' + boundary);
          for (const p of parts) {
            if (p.includes('filename="') && p.includes('Content-Type: image')) {
              const idx = p.indexOf('\r\n\r\n');
              if (idx === -1) continue;
              const data = Buffer.from(p.substring(idx + 4).replace(/\r\n--$/, ''), 'binary');
              const dir = path.join(__dirname, 'uploads');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir);
              const name = 'screenshot_' + Date.now() + '.png';
              fs.writeFileSync(path.join(dir, name), data);
              res.writeHead(302, { Location: '/?uploaded=' + encodeURIComponent(name) });
              res.end();
              return;
            }
          }
          res.writeHead(400); res.end('No image found');
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<form method="post" enctype="multipart/form-data" action="/upload" style="font-family:sans-serif;background:#111;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px"><h1>Upload Screenshot</h1><input type="file" name="file" accept="image/*" style="padding:10px;background:#222;border:1px solid #444;border-radius:8px;color:#fff"><button type="submit" style="padding:10px 30px;background:#10a37f;border:none;border-radius:8px;color:#fff;font-size:16px;cursor:pointer">Upload</button></form>');

    } else if (pathname === '/api/knowledge' && method === 'GET') {
      const urlp = new URL(req.url, 'http://x');
      const search = urlp.searchParams.get('q') || '';
      const tag = urlp.searchParams.get('tag') || '';
      const project = urlp.searchParams.get('project') || '';
      const model = urlp.searchParams.get('model') || '';
      let data = loadKnowledge();
      let entries = data.entries;
      if (search) {
        const q = search.toLowerCase();
        entries = entries.filter(e => (e.title || '').toLowerCase().includes(q) || (e.summary || '').toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q) || e.tags.some(t => t.toLowerCase().includes(q)) || (e.project || '').toLowerCase().includes(q));
      }
      if (tag) entries = entries.filter(e => e.tags.includes(tag));
      if (project) entries = entries.filter(e => e.project === project);
      if (model) entries = entries.filter(e => e.model === model);
      json(req, res, entries);

    } else if (pathname === '/api/knowledge/refresh' && method === 'POST') {
      if (!checkAuth(req)) { json(req, res, { error: 'Unauthorized' }, 401); return; }
      const count = extractAllKnowledge();
      json(req, res, { count });

    } else if (pathname.startsWith('/api/knowledge/') && method === 'GET') {
      const id = pathname.split('/api/knowledge/')[1];
      if (!id || id === 'tags' || id === 'timeline' || id === 'refresh') { json(req, res, { error: 'Invalid id' }, 400); return; }
      const knowledge = loadKnowledge();
      const entry = knowledge.entries.find(e => e.id === id);
      if (!entry) { json(req, res, { error: 'Not found' }, 404); return; }
      json(req, res, entry);

    } else if (pathname.startsWith('/api/knowledge/') && method === 'PATCH') {
      if (!checkAuth(req)) { json(req, res, { error: 'Unauthorized' }, 401); return; }
      const id = pathname.split('/api/knowledge/')[1];
      const knowledge = loadKnowledge();
      const entry = knowledge.entries.find(e => e.id === id);
      if (!entry) { json(req, res, { error: 'Not found' }, 404); return; }
      const body = await parseBody(req);
      if (body.notes !== undefined) entry.notes = body.notes;
      if (body.title !== undefined) entry.title = body.title;
      if (body.tags !== undefined) { try { entry.tags = JSON.parse(body.tags); } catch { entry.tags = []; } }
      entry.timeUpdated = Date.now();
      saveKnowledge(knowledge);
      json(req, res, entry);

    } else if (pathname === '/api/knowledge/tags' && method === 'GET') {
      const knowledge = loadKnowledge();
      const tagSet = new Set();
      for (const e of knowledge.entries) { e.tags.forEach(t => tagSet.add(t)); }
      json(req, res, [...tagSet].sort());

    } else if (pathname === '/api/knowledge/timeline' && method === 'GET') {
      const knowledge = loadKnowledge();
      const now = Date.now();
      const days = 90;
      const timeline = [];
      for (let i = days - 1; i >= 0; i--) {
        const start = new Date(now - i * 86400000);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + 86400000);
        const dayEntries = knowledge.entries.filter(e => e.timeCreated >= start.getTime() && e.timeCreated < end.getTime());
        if (dayEntries.length) {
          timeline.push({ date: start.toISOString().split('T')[0], count: dayEntries.length, entries: dayEntries.map(e => ({ id: e.id, title: e.title, tags: e.tags, project: e.project })) });
        } else {
          timeline.push({ date: start.toISOString().split('T')[0], count: 0, entries: [] });
        }
      }
      json(req, res, timeline);

    } else if (pathname === '/api/pipeline') {
      json(req, res, getPipelineStatus());

    } else if (pathname === '/api/diag') {
      json(req, res, getDiagInfo());

    } else if (pathname === '/api/clear-html-cache') {
      clearHTMLCache();
      json(req, res, { success: true });

    } else if (pathname === '/api/login-log') {
      try {
        if (fs.existsSync(LOGIN_LOG_FILE)) {
          json(req, res, JSON.parse(fs.readFileSync(LOGIN_LOG_FILE, 'utf-8')));
        } else {
          json(req, res, []);
        }
      } catch { json(req, res, []); }

    } else if (pathname.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, pathname.replace(/^\//, ''));
      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const imgTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        res.writeHead(200, { 'Content-Type': imgTypes[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
        res.end(content);
      } catch { json(req, res, { error: 'Not found' }, 404); }

    } else if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
      const filePath = path.join(__dirname, pathname.replace(/^\//, ''));
      const ext = path.extname(filePath);
      const ctypes = { '.css': 'text/css', '.js': 'application/javascript' };
      try {
        let content = fs.readFileSync(filePath, 'utf-8');
        const etag = '"' + crypto.createHash('md5').update(content).digest('hex') + '"';
        if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
        if (ext === '.js') {
          content = content.replace(/^\s*[\r\n]+/gm, '').replace(/  +/g, ' ').replace(/^\s+/gm, '').replace(/\s+$/gm, '');
        }
        if (ext === '.css') {
          content = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*[\r\n]+/gm, '').replace(/  +/g, ' ').replace(/\s*([{}:;,])\s*/g, '$1').replace(/^\s+/gm, '').replace(/\s+$/gm, '');
        }
        const accept = (req.headers['accept-encoding'] || '').toLowerCase();
        const hdrs = { 'Content-Type': ctypes[ext] || 'application/octet-stream', 'ETag': etag, 'Cache-Control': 'max-age=3600', 'Access-Control-Allow-Origin': '*' };
        if (accept.includes('gzip')) {
          const buf = await new Promise((resolve, reject) => {
            zlib.gzip(content, (err, buf) => err ? reject(err) : resolve(buf));
          });
          hdrs['Content-Encoding'] = 'gzip';
          res.writeHead(200, hdrs); res.end(buf);
        } else {
          res.writeHead(200, hdrs); res.end(content);
        }
      } catch {
        json(req, res, { error: 'Not found' }, 404);
      }
    } else {
      json(req, res, { error: 'Not found' }, 404);
    }
  } catch (err) {
    json(req, res, { error: err.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('My AI Dashboard: http://localhost:' + PORT);
  console.log('  Network:    http://100.70.19.81:' + PORT);
});