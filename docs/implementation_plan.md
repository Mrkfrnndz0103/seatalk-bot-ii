** Step 0 — Baseline safety (git hygiene + env)
    TASK: Repo hygiene only.
    - Ensure `.env` is gitignored. Do not commit `.env`.
    - Update `.env.example` to include new vars:
    DRIVE_FOLDER_ID, GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY,
    INDEX_STORE_PATH, MAX_ROWS_TO_SCAN, MAX_COLS_TO_SCAN
    - Add `data/` to .gitignore (index file output).
    - Do NOT modify index.js except if it currently hardcodes secrets: replace with env usage only if already referenced.

    Output: list changed files and exact lines added to .env.example and .gitignore.

** Step 1 — utils/a1.js (column number → letters) 
TASK: Add A1 utilities.
    Create `utils/a1.js` with:
    - colToLetter(n): 1-indexed (1->A, 26->Z, 27->AA)
    - buildRange(tabTitle, rows, cols): returns `${tabTitle}!A1:${colToLetter(cols)}${rows}`
    Include basic input validation.

    Do not touch index.js.

    Output: show function signatures and a couple of inline examples as comments.

** Step 2 — config/env
TASK: Centralize env parsing without refactor.
    Create `config/env.js` exporting a config object:
    - DRIVE_FOLDER_ID
    - GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY (replace \\n with \n)
    - INDEX_STORE_PATH (default ./data/chunks.jsonl)
    - MAX_ROWS_TO_SCAN default 2000
    - MAX_COLS_TO_SCAN default 200
    - SEATALK_BOT_TOKEN / SEATALK_SIGNING_SECRET (if used in existing code)

    Do not force the whole app to use it yet; just export it.

    Output: list required vs optional env vars and defaults.

** Step 3 — clients/drive.client.js (list spreadsheets in folder)
TASK: Implement Google Drive client.
    Create `clients/drive.client.js` using Google Drive API v3 (via googleapis if already present; otherwise use minimal HTTP with axios).
    Implement:
    - listSpreadsheetsInFolder(folderId): returns [{id,name,modifiedTime}]
    Filter: mimeType = application/vnd.google-apps.spreadsheet, and in parents.
    Handle pagination.
    Add retry/backoff for 429/5xx (basic).

    Do not modify index.js.

    Output: show exported functions and how to call listSpreadsheetsInFolder.

** Step 4 — clients/sheets.client.js (tab grid + read values)
TASK: Implement Sheets client.
    Create `clients/sheets.client.js` with:
    - getTabsAndGrid(spreadsheetId): returns [{title,rowCount,colCount}]
    Use spreadsheets.get (fields=sheets(properties(title,gridProperties(rowCount,columnCount))))
    - readValues(spreadsheetId, rangeA1): returns 2D array

    Use env credentials (service account).
    Add basic retry/backoff.

    Output: list both functions and an example call.

** Step 5 — indexing/schema.js + indexing/chunker.js
TASK: Define chunk schema + chunker.
    Create `indexing/schema.js` documenting Chunk shape:
    {
    id, spreadsheetId, spreadsheetName, tabName,
    scanRangeA1, rangeA1,
    text, rows(optional), updatedAt
    }

    Create `indexing/chunker.js`:
    - detectHeaders(values): header row if row1 has >=2 non-empty cells (simple heuristic)
    - toChunks(values, meta, {rowsPerChunk=20}):
    - values already trimmed
    - include headers in text
    - chunk by 20 rows
    - id = `${spreadsheetId}|${tabName}|${startRow}-${endRow}`

    Output: explain header heuristic + chunk text format.

** Step 6 — store/index.store.js + store/file.store.js (JSONL)
TASK: Implement JSONL store.
    Create `store/index.store.js` interface doc.

    Create `store/file.store.js` implementing:
    - constructor({path})
    - load(): loads JSONL into memory array
    - clear(): truncates file and clears memory
    - upsertChunks(chunks): overwrite full file for MVP OR append + rebuild (choose simplest reliable)
    - search(query, topK): return topK using ranker (wire later)

    Ensure directory exists (./data).
    Do not add heavy deps.

    Output: describe storage format and how load() is called.

    ** Step 7 — retrieval/ranker.js + retrieval/retriever.js
    TASK: Simple retrieval.
Create `utils/text.js`:
- normalize(text), tokenize(text): lowercase, split on non-alphanum, remove empty, basic stopwords optional.

Create `retrieval/ranker.js`:
- score(queryTokens, chunkTextTokens): token overlap + simple frequency
Return numeric score.

Create `retrieval/retriever.js`:
- retrieve(query, {topK=3}, store): store.search(query, topK) OR implement in retriever by scoring store chunks.

Output: confirm deterministic sorting + tie-break by updatedAt.

** Step 7 — retrieval/ranker.js + retrieval/retriever.js
TASK: Simple retrieval.
    Create `utils/text.js`:
    - normalize(text), tokenize(text): lowercase, split on non-alphanum, remove empty, basic stopwords optional.

    Create `retrieval/ranker.js`:
    - score(queryTokens, chunkTextTokens): token overlap + simple frequency
    Return numeric score.

    Create `retrieval/retriever.js`:
    - retrieve(query, {topK=3}, store): store.search(query, topK) OR implement in retriever by scoring store chunks.

    Output: confirm deterministic sorting + tie-break by updatedAt.

** Step 8 — indexing/indexer.js (dynamic range detection per tab)
TASK: Build the indexing pipeline with dynamic range detection.
    Create `indexing/indexer.js` that:
    - list spreadsheets in DRIVE_FOLDER_ID
    - for each spreadsheet:
    - getTabsAndGrid()
    - for each tab:
        - rowsToScan=min(rowCount, MAX_ROWS_TO_SCAN)
        - colsToScan=min(colCount, MAX_COLS_TO_SCAN)
        - scanRangeA1 = buildRange(tabTitle, rowsToScan, colsToScan)
        - values = readValues(spreadsheetId, scanRangeA1)
        - trim trailing empty rows/cols
        - finalRows/finalCols -> rangeA1
        - chunk values and accumulate chunks
    - store.clear() then store.upsertChunks(allChunks) (MVP full reindex)
    Return stats: sheetsIndexed, tabsIndexed, chunksWritten.

    Output: describe trimming logic + caps behavior.

** Step 9 — commands/* (help, reindex, search)
TASK: Add command router + 3 commands.
    Create `commands/index.js`:
    - parseCommand(text): returns {cmd,args} or null
    - handle(text, ctx): routes to help/search/reindex; returns {text} response

    Create:
    - help.command.js: shows available commands
    - reindex.command.js: calls indexer.runFullReindex and returns summary
    - search.command.js: calls retriever.retrieve(query) and formats top results with sources

    Response must include citations:
    • Spreadsheet > Tab > RangeA1

    Output: show response format and what’s included.

** Step 10 — Minimal wiring into index.js (keep diff tiny)
    TASK: Wire new command+retrieval without rewriting index.js.
    Locate the existing inbound message handler function (currently echo logic).
    Add minimal changes:
    - require commands + store + retriever + indexer (or a small bootstrap module)
    - Initialize store (load from INDEX_STORE_PATH) once at startup
    - On message:
    - if command -> commands.handle
    - else -> retriever.retrieve and respond
    - If index empty -> tell user to run reindex

    IMPORTANT: do not change webhook verification logic.
    Keep index.js diff small.

    Output: show a minimal diff and list which new modules were required.

-------------------------------------------------------------------------------
Cursor rules file (.cursorrules) version
Create a file named .cursorrules at repo root:

You are editing an existing Node.js (CommonJS) SeaTalk bot repository.

# Non-negotiable constraints
- Do not rewrite or restructure index.js. Only minimal wiring edits are allowed.
- Do not move files into a new src/ tree. Keep existing layout; add new folders alongside index.js.
- Keep CommonJS require/module.exports (no ESM conversion).
- Do not change existing webhook routes, request parsing, or signature verification logic.
- Do not hardcode secrets. Use environment variables. Never commit .env.
- Add new code in new modules/folders; touch existing files only when necessary to wire things up.

# Target feature
Add Google Drive/Sheets indexing + retrieval so the bot can answer questions from all Google Sheets in a Drive folder.

# Required modules/folders to add
clients/: drive.client.js, sheets.client.js
indexing/: schema.js, chunker.js, indexer.js
store/: index.store.js, file.store.js
retrieval/: ranker.js, retriever.js
commands/: index.js, help.command.js, search.command.js, reindex.command.js
utils/: a1.js, text.js, logger.js
data/: runtime output only (gitignored)

# Range detection (must follow)
- Do not assume A:Z.
- Use Sheets API spreadsheets.get to read gridProperties.rowCount/columnCount per tab.
- Cap scan with MAX_ROWS_TO_SCAN and MAX_COLS_TO_SCAN.
- Read scan range A1, then trim empty trailing rows/columns in memory.
- Compute final used rangeA1.

# Bot behavior
- Commands: help, reindex, search <query>
- Non-command: retrieve across chunks and answer
- If index empty: instruct user to run reindex
- Replies include sources: Spreadsheet > Tab > A1 range

# Work style
- Make small, reviewable diffs.
- After changes: summarize files changed and why.
- Avoid adding dependencies unless necessary.
