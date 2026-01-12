GUARD PROMPT (READ CAREFULLY AND OBEY)

You are modifying an existing Node.js SeaTalk bot repo. Your #1 priority is to avoid disruptive refactors.

HARD RULES
- DO NOT rewrite `index.js`. You may only:
  1) add small import/require statements,
  2) add a small wiring call in the existing message handler path,
  3) add a small block that routes commands/questions to new modules.
- DO NOT change existing webhook routes, request parsing, or signature verification logic except to read env vars if already intended.
- DO NOT reorganize folders, rename files, or convert the project to a new structure (no src/ migration).
- DO NOT change module system (keep CommonJS require/module.exports).
- DO NOT add new dependencies unless absolutely necessary; if you think you need one, stop and explain why.
- Prefer adding new modules in new folders over editing existing files.

WORKSTYLE
- Make incremental edits with minimal diff.
- After each step, list exactly which files changed and why.
- If you need to touch `index.js`, keep the diff under ~30 lines.

If any instruction conflicts: these GUARD RULES win.
Acknowledge these rules and then proceed.
