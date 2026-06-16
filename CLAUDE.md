# CLAUDE.md — Working agreement for this repo

Read docs/REFERENCE.md first. It is the master reference for this project (Pocomos auth,
column maps, bucket logic, integrations). Treat it as source of truth and keep it updated.

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
