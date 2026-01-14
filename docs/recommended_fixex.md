Fix recommendations (highest impact)

A. Remove unused / risky dependencies
    1. Lockfile shows you depend on crypto (the npm package) and it is explicitly deprecated because Node already ships crypto built-in. It is also listed in your app dependencies.
**Recommendation**
    - Remove "crypto": "^1.0.1" from package.json and       regenerate package-lock.json.
    - Use only require("crypto") from Node core (no dependency needed).

    2. Lockfile also lists node-fetch 

package-lock

. If your codebase is Node 18+ (it should be), you can use the native fetch() and remove node-fetch unless there is a hard dependency on it.

Recommendation

Remove node-fetch unless you can point to a specific import/usage.

Standardize on Node 20 (or Node 18+) for runtime consistency (see next point).

B. Pin runtime to Node 18+ (preferably Node 20)

Several dependencies require Node 18+ (example: body-parser shows engines: node >=18 

package-lock

). Your Dockerfile already uses Node 20, which is compatible 

Dockerfile

.

Recommendation

Add engines to package.json (e.g., >=18 or >=20) so Render and local dev are aligned.

In Render, set the Node version accordingly (Render respects engines).

C. Webhook security + reliability improvements

Your own internal TODO list flags that signature verification should be based on the raw request body captured by Express, not JSON.stringify(req.body) after parsing 

suggested_todos

.

Recommendation

Implement express.json({ verify }) to capture raw bytes and verify HMAC over raw body 

suggested_todos

.

Add a small unit test set for signature verification (valid/invalid/mismatch) 

suggested_todos

.

D. Performance path for /search

The repo’s own plan calls out /search latency issues and recommends making AI summarization optional, with timeouts and a fast snippet fallback 

suggested_todos

. Your README already documents these flags (SEARCH_USE_LLM_SUMMARY, timeout, cache TTL) 

README

.

Recommendation

Ensure default behavior is fast snippets (no LLM) unless --ai is passed 

suggested_todos

.

Enforce a short LLM timeout and fallback to snippets on timeout 

suggested_todos

.

2) Remove unnecessary files / repo hygiene
A. If you are moving off Docker, remove Docker artifacts

You currently have a Dockerfile 

Dockerfile

 and README Docker instructions 

README

.

Recommendation

If Docker will not be used at all, delete:

Dockerfile 

Dockerfile

The “## Docker” section in README.md 

README

If you want to keep Docker as an optional local/dev path, keep the file but make Render the primary path in README (see section 3).

B. Ensure runtime output and secrets are not committed

Your implementation plan explicitly calls out:

.env must be gitignored

data/ must be gitignored (index output) 

implementation_plan

Recommendation

Confirm .gitignore includes: .env, node_modules/, data/, and any local token files (e.g., GOOGLE_OAUTH_TOKEN_FILE points to a path in .env.example 

.env

).

If .gitignore does not exist, create it with those entries.

C. Clean up .env.example issues (these cause real deployment mistakes)

Your .env.example has:

a duplicated INDEX_STORE_PATH entry 

.env

 and again 

.env

BACKLOGS_WEBHOOK_SECRET missing an equals sign (it’s currently just the key name) 

.env

Recommendation

Remove the duplicate INDEX_STORE_PATH line.

Fix BACKLOGS_WEBHOOK_SECRET= so it is a valid env assignment.

This matters for Render because env var setup is manual; broken examples lead to broken deployments.

3) Replace Docker with Render (recommended setup)
A. Render Web Service configuration

Your own TODO already describes the baseline Render approach: build npm install, start npm start, and set env vars 

suggested_todos

.

Your README also provides health endpoints:

GET /health always OK

GET /ready checks env + index loaded 

README

Recommendation (Render UI settings)

Type: Web Service

Build command: npm ci (or npm install; npm ci is more deterministic)

Start command: npm start

Health check path: /health 

README

Set required env vars (see README required list) 

README

B. Add render.yaml (Blueprint) to remove manual setup

Create a render.yaml so deployments are reproducible. At minimum:

one web service

build + start commands

health check path /health

environment variables (Render supports syncing from dashboard; keep secrets out of git)

This aligns with the repo’s stated “document deployment steps in README” goal 

suggested_todos

.

C. Update README: make Render the primary deployment path

Replace the current Docker section 

README

 with a “Deploy on Render” section that includes:

build/start commands 

suggested_todos

required env vars 

README

health endpoints 

README

4) Check for possible errors and logs before deployment (practical checklist)
A. Local preflight (must pass before Render)

npm ci

npm test (if present) — your TODO explicitly targets tests for signature verification and /search behavior 

suggested_todos

npm start and hit:

GET /health 

README

GET /ready 

README

Trigger a small /search request with and without --ai and validate latency expectations 

suggested_todos

.

B. Render log checks (what to look for)

On first deploy, review Render logs for:

Port binding / listen errors: confirm the app binds to process.env.PORT (your config does this with PORT defaulting to 3000 

env

).

Missing env vars: SIGNING_SECRET and token credentials are required per README 

README

.

Google auth errors (if indexing enabled): validate GOOGLE_PRIVATE_KEY formatting (your config replaces \\n with actual newlines, which is correct for Render secrets) 

env

.

Timeouts: confirm external calls have timeouts; this is explicitly required in the repo’s TODO 

suggested_todos

.

C. Add minimal, actionable logging (so Render logs are useful)

Your TODO calls for structured logging and separating retrieval latency vs LLM latency 

suggested_todos

.
At minimum in production:

log request id/event type

log webhook verification failures (without dumping secrets)

log downstream API failures with status codes and normalized error messages

You already have normalized SeaTalk error mapping in integrations/seatalk.mcp.errors.js 

seatalk.mcp.errors

, which is good practice; use that output in logs to keep errors consistent.

Recommended “change set” summary (what I would do next)

Remove crypto npm dependency (deprecated) 

package-lock

 and likely remove node-fetch 

package-lock

.

Add/verify .gitignore covers .env and data/ 

implementation_plan

.

Fix .env.example duplicate/malformed entries 

.env

 

.env

.

Add render.yaml + update README to make Render primary deployment; remove or demote Docker section 

README

.

Implement raw-body signature verification and add tests 

suggested_todos

.

If you want, I can draft the exact render.yaml and the exact README replacement section tailored to your current scripts and env vars (as documented in your repo).