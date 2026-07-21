# BOARD-V2-BUNDLE — 2026-07-20

Five-item run. All shipped and verified live. Revs 48–50.

## Item 1 — Unblock referral scan + sheet overlay · SHIPPED (rev 48–49)
- **Referral scanner is live.** Drive/Sheets APIs enabled + creds set, so `/api/cron/referrals`
  reads the real payroll sheets. Fixed `matchTechnician`: the live tabs are **"LAST, F"** (first
  initial only), not "LAST, FIRST" as the earlier MCP render suggested — now surname-anchored
  (Levenshtein ≤2 for spelling drift) with first-initial tie-break. Live scan matches the seed
  exactly: **Nicholas Rosales ← Channa Noiman, Nathaniel Tapscott ← Mina Becher**.
- **CALENDAR overlay live.** The prior parser used the wrong column offset (looked for techs at the
  date column). Rewrote it label-anchored (find "Tech" header columns, read fields by label so
  Saturday's missing Van column doesn't shift everything; drop `Tech1..6` placeholders; keep name
  variants). `/tv/board` now shows "routing sheet connected" with tech names live.
- **Judgment call / blocker found:** the cron endpoint is `CRON_SECRET`-gated so I couldn't trigger
  it by hand — instead I ran the identical scanner against the shared Neon DB (same result); Vercel's
  scheduler runs the deployed code nightly. The **Master Routing sheet was initially 403 (not
  shared)**; the user shared it mid-run and I re-verified the overlay lit up.

## Item 2 — Reports convention · SHIPPED
- Added a CLAUDE.md always-true rule: every `/ship`/multi-task run also writes its full report to
  `docs/reports/YYYY-MM-DD-<taskname>.md`, committed with the build. This file is the first
  application.

## Item 3 — Feedback bubble upgrades · SHIPPED (rev 49)
- **Take screenshot** (html2canvas — no permission prompt, chosen over getDisplayMedia) → **markup**
  step (arrows / boxes / freehand, red default, undo/clear) before attaching; "Attach file" kept.
- **Name required** + remembered in `localStorage` (`ms_feedback_name`).
- `/requests`: **by-submitter filter + per-person counts** (AND-combines with the status filter;
  shown only with 2+ submitters).
- Verified live: two attach buttons, name-required enforced, screenshot→markup→attach→submit,
  by-submitter filter narrows correctly.

## Item 4 — /tv/board v2 + /service/board · SHIPPED (rev 50)
- **Tech-first, sheet-primary.** Per day, one row per tech (NAME · DayCode · Van/Loc # · Towns ·
  # Stops) from the CALENDAR; Pocomos daycode list as fallback for unfilled days (currently Wed+).
- **Markers:** ant bug + "Ant needs 3 dry days" caution (3-day forecast ≥55% precip); electric-blower
  bolt (Pocomos route join); LC/LI/BK/GN/QU/WC legend.
- **Right rail:** Announcements (Neon `board_announcements`, editable from `/service/board`), static
  New-customers-1st-spray box, Shout-outs panel.
- **`/service/board`** browser mirror (nav: Service → Route board) with the announcement editor +
  shout-out form + management.
- Verified live at 1080p: sheet connected, 5 tech names, all panels, legend, 13 SVGs, **0 emoji, no
  overflow**.

## Item 5 — Compliments / shout-outs · SHIPPED (rev 50)
- **Roster from column A ONLY** of the Technician sheet (range `A1:A`, never widened — other columns
  hold credentials/PII). Comma-format filter keeps the **8 real techs** (incl. head techs Cesar
  Barrera + Emanuel McAuliffe, compliment-eligible though award-excluded) and drops asset rows
  ("LOCKER", "OFFICE SPARE"). Nightly cron `/api/cron/tech-roster`.
- **Shout-out form** on `/service/board` (roster dropdown, ≤160 chars, from-name localStorage-remembered,
  optional customer) → `compliments` table.
- **Shout-outs panel** on both boards: 7-day window, newest first, rotates every 12s on overflow,
  SVG megaphone, no emoji. **Soft-delete** (hide/restore) from the browser page.
- Verified end-to-end: post → appears active → hide → DB confirms `hidden=true`.

## Follow-ups for a human
- Nothing blocking. The board's ant/electric-blower markers only appear when a day actually has an
  ANT route or a scheduled electric-blower customer — none today, so absence is correct.
