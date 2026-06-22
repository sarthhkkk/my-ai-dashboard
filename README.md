# My AI Dashboard

A minimal, zero-dependency web dashboard for browsing AI chat sessions stored in SQLite. Built with pure Node.js (no npm packages).

## Features

- **Session browser** — list of all past sessions with timestamps and model info
- **Chat view** — click any session to see the full conversation (messages, tool calls, code output)
- **Dark theme** — easy on the eyes, modern UI
- **Zero dependencies** — uses only Node.js built-in `http`, `fs`, `child_process`
- **Runs in background** — lightweight (~5 MB RAM), meant to stay running

## Prerequisites

- **Node.js** (v16+)
- **sqlite3 CLI** — If you have Platform Tools or Android Studio, the server auto-detects the bundled `sqlite3.exe`. Otherwise install via: `winget install sqlite` or `choco install sqlite`

## Quick Start

```bash
node dashboard.js
```

Open `http://localhost:3344` in your browser.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `DASHBOARD_PORT` | `3344` | Web server port |
| `OPCODE_DB` | `~/.local/share/opencode/opencode.db` | Path to the SQLite database |
| `SQLITE3_PATH` | auto-detected | Path to `sqlite3` executable |

### Example with custom port and DB

```bash
set DASHBOARD_PORT=5000
set OPCODE_DB=C:\Users\me\custom.db
node dashboard.js
```

## Run in Background (Windows)

```powershell
Start-Process node -ArgumentList "dashboard.js" -WindowStyle Hidden
```

To stop it:

```powershell
Get-Process -Name node | Where-Object { $_.CommandLine -match "dashboard" } | Stop-Process
```

## API Endpoints

| Endpoint | Returns |
|---|---|
| `GET /` or `/dashboard` | HTML page |
| `GET /api/sessions` | JSON list of sessions (last 100) |
| `GET /api/session/<id>` | JSON session details |
| `GET /api/messages/<sessionId>` | JSON messages with parts for a session |

## Database Schema

The server expects an opencode-compatible SQLite database at the configured path with these tables:

- `session` — chat sessions (id, title, time_created, time_updated, model, agent, cost, tokens)
- `message` — messages within a session (id, session_id, data as JSON with role)
- `part` — content parts of messages (id, message_id, data as JSON with type and text)

## License

MIT
