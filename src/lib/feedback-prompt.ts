/**
 * Builds a ready-to-paste Claude Code prompt from selected feedback items
 * (rev 42). Pure function so the /requests view and a test can share it.
 *
 * The header/footer encode this repo's shipping ritual (probe-first, docs rev
 * bump, commit/push/verify, per-item report) so a pasted prompt drops straight
 * into a `/ship` flow.
 */
/** Just the fields the prompt needs — keeps it usable from list rows. */
export interface PromptItem {
  id: number;
  body: string;
  submitter: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

const shortDate = (iso: string) => {
  // iso is a Postgres timestamptz text; take the date part, keep it stable.
  const d = iso.slice(0, 10);
  return d || iso;
};

/** Strip the origin so the prompt cites the route, not the deploy host. */
function pagePath(url: string | null): string {
  if (!url) return "(unknown page)";
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}

export function buildFeedbackPrompt(items: PromptItem[]): string {
  if (items.length === 0) return "";
  const header = [
    "Ship the following dashboard feedback items, gathered from staff via the in-app",
    "feedback bubble. Follow the MS Operations Hub shipping ritual: probe first (READ-ONLY",
    "against Pocomos), build reusing the existing report/UI conventions, keep it year-relative,",
    "typecheck + build clean, then bump docs/REFERENCE.md (+rev note) and docs/BACKLOG.md,",
    "commit, push, deploy, and VERIFY LIVE via Playwright (not curl+regex).",
    "",
    "Items:",
  ].join("\n");

  const body = items
    .map((it, i) => {
      const who = it.submitter ? ` — from ${it.submitter}` : "";
      const text = it.body.trim().replace(/\s+$/g, "");
      return `${i + 1}. ${text}\n   (page: ${pagePath(it.sourceUrl)} · submitted ${shortDate(
        it.createdAt
      )}${who} · feedback #${it.id})`;
    })
    .join("\n\n");

  const footer = [
    "",
    "Report per item: what shipped, any numbers moved, judgment calls, and what you verified live.",
    "If an item is ambiguous or turns out to be a bad idea, say so rather than guessing — and note",
    "which feedback #s to mark Shipped vs Declined on /requests when done.",
  ].join("\n");

  return `${header}\n\n${body}\n${footer}\n`;
}
