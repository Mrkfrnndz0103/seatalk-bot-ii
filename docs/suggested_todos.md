You are Codex acting as a senior backend engineer + performance specialist. Your job is to audit and upgrade the GitHub repo `Mrkfrnndz0103/seatalk-bot-ii` to be production-ready, secure, and fast.

GOALS
1) Make the bot respond significantly faster (p50 and p95 latency).
2) Improve deploy readiness (Docker + health checks + env clarity).
3) Improve reliability (webhook signature verification, error handling, timeouts, observability).
4) Keep changes minimal but high impact; avoid breaking existing behavior.

CONSTRAINTS
- Do not add heavy dependencies unless necessary.
- Prefer simple Node/Express patterns.
- Keep commands backwards compatible.
- Add tests where it provides confidence for critical logic (signature verification, retrieval scoring, /search behavior).

REPO CONTEXT (WHAT YOU MUST LOOK FOR)
- Webhook server using Express; signature validation currently derived from `JSON.stringify(req.body)` after parsing.
- `/search` command performs retrieval and then calls an LLM summarizer (OpenRouter), which adds latency.
- Retrieval currently tokenizes all stored items per request (O(N) per query).
- There is unreachable logic in `handleSubscriberMessage` due to a `return` after sending fallback reply.
- Fallback path may call Seatalk profile API and includes a greeting even though the prompt asks to avoid greetings.

TASKS (DO THESE IN ORDER)

A) PERFORMANCE: FAST RESPONSE PATH (HIGHEST PRIORITY)
1) Make `/search` fast by default:
   - Add env flag `SEARCH_USE_LLM_SUMMARY` (default false).
   - If false, return top results snippets immediately (include sources).
   - If true, run summarization, but enforce a short timeout (e.g., 1500–2000ms) and fall back to snippets on timeout.
   - Add a `--ai` option to the `/search` command to force AI summarization per request.
2) Remove unnecessary network calls on fallback:
   - Skip Seatalk display name lookup unless explicitly requested.
   - Remove greeting prefix for compliance with system prompt.
3) Add simple in-memory caching:
   - Cache LLM responses per (normalized question + top retrieval ids) for a short TTL (e.g., 60–180s) to avoid repeated calls.
   - Cache Seatalk display names (if still used) with TTL (e.g., 1 hour).

B) PERFORMANCE: RETRIEVAL ENGINE
1) Token caching:
   - Precompute tokens for each store item at load time: `item.tokens = tokenize(item.text)`.
   - Ensure retrieval uses `item.tokens` rather than tokenizing each time.
2) Scoring improvements (without heavy ML):
   - Add lightweight ranking improvements: prioritize exact phrase matches and title matches (if present).
   - Ensure stable sorting; cap per-token overlap to avoid spammy long chunks winning.
3) Optional: build a simple inverted index:
   - token -> list of item ids for candidate narrowing.
   - Only compute scores for candidates; fall back to scanning all if index missing.

C) SECURITY/DEPLOY READINESS
1) Fix webhook signature verification:
   - Capture raw request body via `express.json({ verify })`.
   - Verify HMAC signature using raw bytes. Keep backward compatibility with existing header naming.
   - Add tests covering valid/invalid signatures and raw body mismatch cases.
2) Add production HTTP hardening:
   - Set request body size limit.
   - Add basic rate limiting or per-IP throttling (lightweight).
   - Ensure all external calls have timeouts (Seatalk API, OpenRouter).
3) Add health/readiness endpoints:
   - `/health` returns OK always.
   - `/ready` returns OK only if required env vars are present and index is loaded.
4) Free Deployment Options:
   - Deploy to Render.com (Free tier):
     - Connect GitHub repo
     - Set build command: `npm install`
     - Set start command: `npm start`
     - Configure environment variables
     - Enable auto-deploy on main branch

   - Document deployment steps in README:
     - Environment variables required
     - Recommended free hosting options
     - Process management with PM2
     - Health check endpoint detailsD) RELIABILITY + OBSERVABILITY
1) Add structured logging:
   - Log request id, event type, command type, and latency.
   - Log LLM duration separately from retrieval duration.
2) Add error handling:
   - Ensure webhook handler never crashes the process.
   - Return safe responses on errors.
3) Add metrics hooks (lightweight):
   - Simple counters/timers in logs (no external service required).

E) CODE QUALITY
1) Remove unreachable code in `handleSubscriberMessage`:
   - Refactor into clear flow:
     - Attempt retrieval -> if good result, respond quickly.
     - Else fallback to LLM (with timeout), respond.
   - Delete or re-enable the sheet/tab logic; do not leave dead blocks.
2) Improve configuration management:
   - Create `.env.example` listing required env vars.
   - Centralize config in one module (reading process.env once).
3) Add tests:
   - Signature verification tests.
   - Retrieval token cache behavior and scoring correctness.
   - `/search` option parsing (snippets vs AI).

DELIVERABLES
- Implement the changes in the repo.
- Provide a short CHANGELOG in the PR description.
- Include a "Performance Notes" section summarizing:
  - expected latency improvements,
  - what is now the critical path,
  - how to tune env flags.
- Ensure `npm test` and `npm run lint` (if available) pass.

OUTPUT FORMAT
1) List the files changed/added.
2) Provide the patch (or clear code diffs) for each file.
3) Provide updated README sections: Deployment, Env Vars, Performance flags.

Begin by scanning the repo structure and identifying where:
- webhook parsing and signature verification happens,
- `/search` is implemented,
- retrieval and tokenization is implemented,
- OpenRouter calls and Seatalk profile calls are implemented.
Then implement tasks A → E.
