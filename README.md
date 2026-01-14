# SeaTalk Bot

Node.js SeaTalk bot that answers questions from Google Sheets, supports search and reindexing, and can reply to group mentions.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Create `.env` using `.env.example`.

3) Configure `sheets.txt` with one spreadsheet URL per line (used for `/search` indexing). Backlogs/truck intents read from the fixed sheet IDs in `services/intent.service.js`.

## Run

```bash
npm start
```

## Commands

- `/help`
- `/search <query> [--ai]`
- `/reindex`

## Health Endpoints

- `GET /health` -> always OK
- `GET /ready` -> checks env + index loaded

## Event Hooks

- `POST /seatalk/notify` -> signed notification push (provide `group_id` or `employee_code`)
- `POST /v1/bot/events` -> generic event ingest (see `docs/seatalk_events.md`)
- `SCHEDULED_INTERVAL_MINUTES` -> emits scheduled events to logs at a fixed interval

## MCP Integration

This bot can connect to the SeaTalk MCP server for messaging and profile tools.

Modes:
- Production: set `MCP_ENDPOINT` to your MCP endpoint URL.
- Local dev: leave `MCP_ENDPOINT` empty to spawn `npx -y seatalk-mcp-server` via stdio.

Note: `MCP_ENDPOINT` expects a JSON-RPC compatible MCP proxy endpoint. If your MCP server only exposes stdio, use the local dev mode or run a proxy that exposes HTTP.

Example MCP settings (for Cursor or MCP-compatible tools):
```json
{
  "mcpServers": {
    "seatalk-mcp-server": {
      "command": "npx",
      "args": ["-y", "seatalk-mcp-server"],
      "env": {
        "SEATALK_APP_ID": "your_app_id_here",
        "SEATALK_APP_SECRET": "your_app_secret_here"
      },
      "disabled": false
    }
  }
}
```

Env vars:
- `MCP_ENDPOINT` (optional) -> MCP HTTP endpoint for production.
- `MCP_TRANSPORT` -> `auto` (default), `stdio`, or `http`.
- `MCP_SERVER_NAME` -> default `seatalk-mcp-server`.

## Env Vars

Required:

- `SIGNING_SECRET`
- `BOT_ACCESS_TOKEN` or Seatalk app credentials (`SEATALK_APP_ID`, `SEATALK_APP_SECRET`, `SEATALK_TOKEN_URL`)

Common:

- `SHEETS_FILE`
- `INDEX_STORE_PATH`
- `SHEETS_SCAN_ALL_TABS`
- `SEARCH_USE_LLM_SUMMARY`

See `.env.example` for the full list.

## Performance Flags

- `SEARCH_USE_LLM_SUMMARY=false` keeps `/search` fast by returning snippets.
- Use `/search <query> --ai` to force LLM summarization per request.
- `SEARCH_LLM_TIMEOUT_MS` caps LLM latency.
- `SEARCH_LLM_CACHE_TTL_MS` caches LLM summaries for repeated queries.
