# SeaTalk Bot

Node.js SeaTalk bot that answers questions from Google Sheets, supports search and reindexing, and can reply to group mentions.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Create `.env` using `.env.example`.

3) Configure `sheets.txt` with one spreadsheet URL per line.

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

## Docker

```bash
docker build -t seatalk-bot .
docker run --rm -p 3000:3000 --env-file .env seatalk-bot
```
