# CLAUDE.md — Working agreement for this repo

Read docs/REFERENCE.md first. It is the master reference for this project (Pocomos auth,
column maps, bucket logic, integrations). Treat it as source of truth and keep it updated.

## Docs are the source of truth — keep GitHub current, always
- `docs/REFERENCE.md` (architecture, APIs, data model, decisions) and `docs/BACKLOG.md`
  (pending-work queue, prioritized) are the canonical state of this project. They live in the
  GitHub repo and auto-sync into the Claude project knowledge, so new chats read them without
  any upload.
- At the END of every work session — and immediately after shipping any change that alters
  architecture, endpoints, data model, bucket/categorize logic, env vars, or the task queue — you
  MUST update `docs/REFERENCE.md` and `docs/BACKLOG.md` to reflect reality, then commit and push to
  main. Do this automatically, without being asked. A change isn't "done" until the docs are
  updated and pushed.
- `BACKLOG.md` rules: when a task is completed, move it to a "Shipped"/"Done" section with a
  one-line note; when a new task or decision emerges, add it with priority. Keep it current enough
  that a fresh chat can pick up the next task from `BACKLOG.md` alone.
- `REFERENCE.md` rules: keep it accurate to shipped reality (not aspirational). If code and doc
  disagree, fix the doc in the same session.
- If `docs/BACKLOG.md` does not exist, create it from the current known pending items and commit it.
- Never leave the working tree with doc changes uncommitted at session end.

## How to work here
- Work autonomously start to finish. Do NOT ask for confirmation. Make reasonable choices on
  ambiguity and note them in your final report. Only stop if something is destructive,
  irreversible, or genuinely blocks the build.
- READ-ONLY against Pocomos unless explicitly told otherwise — GET only, never mutate records,
  never switch a customer's active contract.
- After any build: update docs/REFERENCE.md, then build, commit, push, and verify LIVE.
- Self-probing builds: when a build depends on a data field or behavior we haven't confirmed,
  probe it FIRST in the same session, print what you found, then proceed to build using the
  finding — do not stop to ask. Only split into a separate probe-only run if I explicitly say
  "probe only."
- Maintain docs/BACKLOG.md: when I say "add X to the backlog," add it; when I say "build,"
  pull the next item(s) from it and update their status. Keep it current.
- End of every session: update the REFERENCE.md rev note + BACKLOG.md statuses, commit, and push.
  The GitHub-synced docs are what every new chat reads — never end a session with stale docs.

## Command hygiene (PowerShell on Windows) — prevents approval prompts
- Commit messages: git commit -m "short single line", OR a message file in the PROJECT ROOT
  (git commit -F msg.txt then delete it). NEVER write into .git\.
- Call vercel via npx vercel or a resolved PATH string — never & "$env:APPDATA\npm\vercel.cmd".
- No $(...) subexpressions, no Set-Location "...";& wrappers, no output redirection/re-read
  (> file; Get-Content, Select-String, Select-Object -Skip/-First on commands). Put verification
  in a .ts script run as one plain node script.ts that logs only what's needed.
- Assume you're already in the project directory; call node/git/npm/vercel directly.

## Conventions
- Year logic must be relative: compute from CURRENT_YEAR / (CURRENT_YEAR - 1). Never hardcode a year.
- Display-only tasks must not touch categorize.ts / sales-provider.ts / sales-data.ts / any lib/
  data file. If you find yourself editing those during a display task, STOP.
- Profile/customer links open in a new tab (target="_blank" rel="noopener noreferrer").
- Probe-first: confirm a field exists in live data before building against it.
- Follow the UI tokens in docs/REFERENCE.md §6.1 (one type scale; semantic color only).
