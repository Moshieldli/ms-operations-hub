# CLAUDE.md — Working agreement for this repo

**MS Operations Hub** — internal ops dashboard for Mosquito Shield of Long Island. Next.js 14
(App Router, `src`, `@/*`) + TypeScript + Tailwind v3 + shadcn/ui + Neon Postgres, on Vercel Pro.
Reads live from Pocomos (the pest-control CRM); nightly crons persist snapshots/caches in Neon.

Read `docs/REFERENCE.md` first — it is the master reference (architecture, APIs, column maps,
bucket logic, per-page detail) and the source of truth. `docs/BACKLOG.md` is the prioritized work
queue. Both live in the repo and sync into the Claude project knowledge, so every new chat reads
them without any upload.

## Skills & commands (load the skill; don't inline its content here)
- **`pocomos-scraping`** — reading Pocomos safely: surfaces, session handling, the legacy
  DataTables 1.9 body, the Symfony-report form pattern, id conversion, and the mutation
  **landmines**. Load it for anything touching Pocomos.
- **`dashboard-conventions`** — the cron+cache+refresh report pattern, shared components
  (`RowTable`/`PausedBalanceCard`/`CollapsibleSection`/`NavDropdown`), stat-box + drill-down
  idioms, tone colors. Load it when building/editing a page.
- **`/ship <spec>`** — the full shipping ritual (probe → build → docs → commit → push → verify
  live → report). Start a build session with it.

## Always-true rules
- **READ-ONLY against Pocomos** — GET + DataTables-read POST only. Never mutate a record, never
  switch a customer's active contract. The landmine list lives in the `pocomos-scraping` skill.
  405-on-GET = an ACTION, not a feed.
- **Year-relative logic** — derive from `CURRENT_YEAR` / `CURRENT_YEAR - 1`; never hardcode a year.
- **Docs are the deliverable.** A change isn't done until `docs/REFERENCE.md` (+rev note) and
  `docs/BACKLOG.md` reflect it, committed and pushed. Never end a session with stale docs.
- **Work autonomously.** Don't ask for confirmation; make reasonable calls on ambiguity and note
  them in the final report. Only stop for something destructive, irreversible, or blocking.
- **Display-only tasks must not touch** `categorize.ts` / `sales-provider.ts` / `sales-data.ts`.

## Verify LIVE via Playwright — NOT curl+regex
After deploying, verify the deployed UI with a real browser: `scripts/verify-live.ts` (smoke test
of the key pages) or `scripts/lib/livecheck.ts <url> [clickText] [expectText...]` for specific UI.
`curl | grep` gives **false FAILs** — React inserts `<!-- -->` comment nodes, renders
en-dashes/entities, orders attributes unpredictably, and dropdown/collapsible children only appear
**after a click**. Assert on the rendered DOM. (The Playwright MCP is configured in `.mcp.json` for
interactive use; `scripts/lib/livecheck.ts` is the scripted path.)

## Deploying
GitHub → Vercel auto-deploy **works** (confirmed rev 27: a push produced a git-triggered
`…-git-main-…` production deployment ~2 min later, no CLI). It has flaked before (a push once
produced no deployment), so after pushing, **confirm a fresh deployment exists** — if none appears
within ~2–3 min, run the manual deploy: `npx vercel --prod --scope moshieldlis-projects --yes`.
Then verify live (below). `/ship` does this.

## Long backfills — background/cron-first, never block a session
A one-off backfill or full re-scrape that runs more than ~a couple of minutes must NOT run inline
in the foreground:
- Prefer the **nightly cron** to do it incrementally (resumable: process the staleest chunk each
  run, budget-capped — see `refreshMosquitoStatus`), or trigger the production **"Refresh now"**
  endpoint and move on.
- If you must run it locally, use a **background** Bash run (`run_in_background: true`) and keep
  working; check back when notified. Don't sit in a foreground wait.
- Say what you deferred and how it will finish (which cron, when).

## Command hygiene (PowerShell on Windows) — prevents approval prompts
- Commit messages: `git commit -m "short single line"` (or `-F msg.txt` in the PROJECT ROOT, then
  delete it). NEVER write into `.git\`.
- Call vercel via `npx vercel`; node/git/npm/npx directly. Assume you're already in the project dir.
- No `$(...)` subexpressions, no `Set-Location "...";&` wrappers, no output-redirect-then-re-read.
  Put verification in a `.ts` script run as one `node … script.ts` that logs only what's needed.
- Script helpers live in `scripts/lib/` (`livecheck`, `pocomos`, `csv`, `neon`) — reuse them.
- Profile/customer links open in a new tab (`target="_blank" rel="noopener noreferrer"`).
