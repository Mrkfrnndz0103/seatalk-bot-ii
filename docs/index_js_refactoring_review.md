# index.js Refactoring Review (Seatalk Bot)

This document provides a detailed, complete refactoring analysis of the current `index.js` for the Seatalk bot project. The intent is to improve **maintainability**, **testability**, **performance**, and **deployment stability** (especially on Render), while keeping behavior stable through incremental, low-risk changes.

> Scope: Refactor guidance only (not a behavioral redesign).  
> Primary goal: Turn `index.js` into a small bootstrap file and move domain logic into cohesive modules.

---

## Executive Summary

### Current state
`index.js` is a “god file” that mixes:
- App bootstrap and server lifecycle
- HTTP middleware and request parsing
- Seatalk authentication and API client calls
- Webhook validation and event routing
- Profile lookup and caching (MCP integration)
- Search/index operations
- Google Sheets OAuth + data caching and matching logic
- Scheduled backlogs publishing
- Command parsing and conversational fallbacks

This mixture increases the risk of:
- Changes breaking unrelated functionality
- Slow onboarding for maintainers
- Difficulty writing unit tests
- Memory growth in long-running processes due to in-memory caches
- Inconsistent logging (console + logger) and potential leakage of runtime details

### Recommended target state
- `index.js` only does:
  1) load config
  2) create Express app
  3) register middleware + routes
  4) start server
- All logic moves into modules organized by bounded context:
  - `src/http/*`
  - `src/seatalk/*`
  - `src/profile/*`
  - `src/handlers/*`
  - `src/sheets/*`
  - `src/backlogs/*`
  - `src/search/*`
  - `src/llm/*` (optional, if used)

---

## Key Findings (High Impact)

### 1) Mixed responsibilities in one file (primary maintainability risk)
When a single file owns multiple domains, it becomes difficult to:
- enforce invariants (e.g., token validity, caching rules)
- isolate performance hotspots
- test without full integration environment

Refactoring should split domains into modules with narrow interfaces.

---

### 2) Duplicated logic inside message routing
The subscriber message handler path includes duplicated greeting-only checks. This is a correctness and readability smell because it suggests the routing logic is not expressed as a clear pipeline.

**Recommendation**
- Refactor message routing into a single-pass pipeline:
  - parse text → classify intent → dispatch handler
- Ensure each route is exclusive, and returns once handled.

---

### 3) Logging consistency and security hygiene
Startup includes ad-hoc environment inspection logging and scattered `console.warn()` usage in multiple workflows.

**Risks**
- Inconsistent observability (hard to grep or correlate requests)
- Potential leakage of information in shared logs

**Recommendation**
- Standardize all logging through a single logger instance
- Use structured logging (JSON) for Render
- Avoid logging which secrets exist or do not exist

---

### 4) In-memory caches without clear lifecycle or pruning
Multiple module-level caches exist (rate limiting, token, profile, sheets). These are acceptable for a single instance but require:
- pruning/TTL discipline to avoid memory creep
- clean abstraction so you can later swap to Redis / external cache

**Recommendation**
- Move each cache into its owning service module
- Define TTL and cleanup behavior in one place
- Instrument cache hit/miss counters to understand behavior in production

---

### 5) Style/structure drift (reviewability risk)
Portions of the code show indentation/structure drift in large functions, making diffs noisy and increasing the chance of missed logic errors.

**Recommendation**
- Extract large functions into modules and smaller functions
- Keep a consistent formatting tool (`prettier`) and lint rules (`eslint`)

---

## Refactoring Principles (How to keep it low-risk)

1) **Strangler pattern**
- Move one bounded context at a time.
- Keep exported function signatures simple.
- Keep behavior unchanged.

2) **Keep the webhook path stable**
- Webhooks are the highest-risk entry point.
- Do not alter request parsing, signature verification, or reply formatting while extracting modules.

3) **Unit tests at module boundaries**
- Add tests as you extract modules, not at the end.
- Focus on edge cases (token refresh, greeting detection, command parsing, tab matching).

4) **Observability-first**
- Any refactor should improve log clarity and error reporting.
- Add request IDs and latency logging early.

---

## Recommended Target Architecture

### Folder structure

```
src/
  index.js                  # bootstrap only (or server.js)
  http/
    app.js                  # createExpressApp()
    middleware/
      rawBody.js
      rateLimit.js
      requestContext.js
  seatalk/
    auth.js                 # token refresh + caching
    client.js               # requestWithAuth/postWithAuth
    webhook.js              # verify signature, parse event
  profile/
    profileService.js       # fetch profile + cache policy
    mcpClient.js            # MCP integration wrapper
  handlers/
    subscriberMessageHandler.js
    commandHandler.js
    intentRouter.js
  search/
    indexStore.js           # load/search/reindex operations
    searchService.js
  sheets/
    sheetsClient.js         # OAuth/service account init
    sheetsCache.js          # caching + refresh orchestration
    tabMatcher.js           # tab scoring + match helpers
    sheetsContext.js        # build context strings
  backlogs/
    publisher.js            # scheduled update pipeline
  llm/
    summarizer.js           # optional: LLM summary routing
  utils/
    text.js                 # normalize/tokenize helpers
    time.js                 # timestamp helpers
    errors.js               # typed errors + helpers
```

This layout aligns each module with a clear responsibility and reduces cross-domain coupling.

---

## Detailed Extraction Plan (Step-by-step)

### Phase 0 — Safety net (before moving code)
**Objective:** reduce refactor risk.

- Add `eslint` + `prettier` and apply formatting once (single baseline commit).
- Add minimal smoke tests:
  - `/health` returns 200
  - `/ready` returns non-200 when required env missing
  - webhook route returns 200 for a simple mocked event (no external calls)

---

### Phase 1 — Extract HTTP middleware (lowest risk)
**What to extract**
- Raw body capture middleware (for signature verification)
- `getClientIp` helper
- Rate limiting middleware
- Request context (requestId) middleware

**Why this is low risk**
- Functions are already fairly self-contained.
- Interfaces are simple: `(req, res, next)`.

**Deliverable**
- `src/http/middleware/rawBody.js`
- `src/http/middleware/rateLimit.js`
- `src/http/middleware/requestContext.js`

**Acceptance criteria**
- No behavior change
- Same routes and status codes
- Same webhook signature verification behavior

---

### Phase 2 — Extract Seatalk auth + API client
**What to extract**
- Access token cache
- Refresh policy (buffer window)
- Single-flight refresh logic (avoid stampede)
- `requestWithAuth` / `postWithAuth` wrappers
- Unauthorized detection and retry logic

**Files**
- `src/seatalk/auth.js`
- `src/seatalk/client.js`

**Why**
- This is critical infrastructure and the main “external boundary” for Seatalk API calls.
- Clean abstraction allows easy instrumentation and later retries/backoff improvements.

**Acceptance criteria**
- Token refresh still occurs only once per concurrent burst.
- Retries are consistent and bounded.
- No change in Seatalk API request payloads or headers.

---

### Phase 3 — Extract profile lookup and caching policy
**What to extract**
- Profile cache Map and TTL behavior
- Temporary disable policy for repeated failures
- MCP lookup wrapper and fallback behavior
- Normalization of email/user fields and safe defaults

**Files**
- `src/profile/profileService.js`
- `src/profile/mcpClient.js`

**Special note**
- Remove any hardcoded personal routing in the greeting logic. If VIP routing is required, make it configuration-driven:
  - env var allowlist (comma-separated) or a JSON file in non-sensitive config.

**Acceptance criteria**
- Profile lookup behavior unchanged (same fallbacks)
- Cache hit/miss metrics are logged (optional but recommended)

---

### Phase 4 — Extract subscriber message routing into a pipeline
**Problem addressed**
- Duplicate greeting-only checks
- Hard-to-follow decision tree

**Solution**
Create a single-pass routing pipeline:

1) Parse message text
2) Apply normalization and mention stripping
3) Run classification:
   - greeting-only
   - command
   - intent
   - employee lookup tool policy
   - index search fallback
   - LLM fallback
4) Reply once; return

**Files**
- `src/handlers/subscriberMessageHandler.js`
- `src/handlers/commandHandler.js`
- `src/handlers/intentRouter.js`

**Key improvement**
- Make each handler return a structured result:
  - `{ handled: true, replyText, attachments? }`
  - `{ handled: false }`

This avoids deeply nested `if` blocks and guarantees “only one reply”.

**Acceptance criteria**
- Eliminates redundant checks
- Deterministic routing order
- No double replies

---

### Phase 5 — Extract Google Sheets service (large, should be isolated)
**What to extract**
- Sheets OAuth/service account initialization
- Token load/refresh behavior for Google credentials
- Caching and refresh scheduling (single-flight promise)
- Tab scoring / matching and data selection
- Context building for response formatting

**Files**
- `src/sheets/sheetsClient.js`
- `src/sheets/sheetsCache.js`
- `src/sheets/tabMatcher.js`
- `src/sheets/sheetsContext.js`

**Why this matters**
- Sheets logic is complex and has its own lifecycle and caching model.
- This should be testable with mocked sheets responses.

**Acceptance criteria**
- Cache refresh behavior remains stable
- Same tab chosen for same query (tab matcher is unchanged)
- Same formatting output (context builder unchanged)

---

### Phase 6 — Extract scheduled backlogs publisher
**What to extract**
- Fetch image or sheet export pipeline
- Text formatting for scheduled updates
- Scheduled send orchestration and error handling

**Files**
- `src/backlogs/publisher.js`

**Acceptance criteria**
- Scheduled message behavior unchanged
- Improved logs for failure modes (image fetch, Seatalk post)

---

## Specific Refactor Recommendations for `index.js`

### 1) Convert index.js into bootstrap-only
After extracting modules, `index.js` should resemble:

- Load env/config
- Create app via `createApp({ config, logger })`
- Register routes:
  - webhook routes
  - `/health`, `/ready`
- Start server and attach graceful shutdown

This reduces risk and makes the project easier to maintain long term.

---

### 2) Standardize errors and retries
Currently, error handling varies between `console.warn`, `logger.warn`, and silent fallbacks.

**Recommendation**
- Define a small set of typed errors:
  - `UnauthorizedError`
  - `TransientNetworkError`
  - `ConfigError`
- In Seatalk client, implement:
  - bounded retries
  - exponential backoff (small)
  - retry only on safe conditions (timeouts, 429, 5xx)

---

### 3) Improve cache lifecycle management
Add explicit cleanup mechanisms:

- Rate limit Map:
  - prune expired entries every N minutes
- Profile cache:
  - TTL-based cleanup
- Sheets cache:
  - time-based refresh with jitter to avoid synchronized refreshes across instances
- Token cache:
  - refresh before expiry with buffer and jitter

---

### 4) Replace scattered text utilities with `src/utils/text.js`
Functions such as:
- normalize
- tokenize
- match scoring helpers
should be centralized and unit tested.

This improves correctness and avoids drift where multiple variants of “normalize” exist.

---

## Testing Strategy (Recommended)

### Unit tests (fast)
- Seatalk token refresh single-flight behavior
- Profile caching + disable window
- Command parsing
- Greeting-only detection
- Tab matcher scoring

### Integration tests (moderate)
- Mock Seatalk API: webhook → handler → reply
- Mock Sheets API: query → tab match → response

### Smoke tests (deployment)
- `/health` returns 200
- `/ready` returns 503 when missing env
- `/ready` returns 200 when fully configured

---

## Performance and Longevity Recommendations

### 1) Keep fast path fast
- Greeting-only and simple commands must be O(1) and avoid external calls where possible.
- Profile lookup should be cached and best-effort, not blocking a basic reply.

### 2) Constrain slow operations
- LLM summarization should be optional and time-bounded.
- Sheets refresh should be scheduled and cached, not executed per request.

### 3) Render-friendly operational design
- Use `/ready` as hard gate for required config and index readiness.
- Add SIGTERM graceful shutdown to avoid partial deploy failures.
- Use JSON structured logs for fast incident triage.

---

## “Definition of Done” for the refactor

1) `index.js` is < 200 lines and contains no domain logic.
2) Each bounded context has its own module and tests.
3) No duplicated routing conditions in subscriber handler.
4) Logs are consistent, structured, and safe for production.
5) Caches have TTL/cleanup and are instrumented.
6) Render health checks use `/ready` and deployments fail fast when misconfigured.

---

## Appendix: Suggested Refactor Roadmap (Commit Plan)

1) Formatting + baseline lint (no behavior change)
2) Extract HTTP middleware
3) Extract Seatalk auth/client
4) Extract profile service
5) Refactor subscriber routing pipeline
6) Extract Sheets service
7) Extract backlogs publisher
8) Final cleanup: index.js bootstrap-only + documentation update
