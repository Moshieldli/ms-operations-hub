/**
 * Synthetic verification of the PhoneBurner Call End webhook parser.
 *
 * Builds payloads matching the REAL field shape (status / agent /
 * typed_custom_fields / contact.notes-as-history-string / recording_url_public)
 * and runs them through `parseWebhook` to verify:
 *   - Field extraction picks the right keys
 *   - Latest-entry extraction grabs only the first entry from the multi-line
 *     `contact.notes` history (not the whole string)
 *   - The phone-prefix segment between date and body gets stripped
 *   - The auto-disposition heuristic blanks "Notes:" when the entry body is
 *     just PB auto-text re-stating the disposition
 *   - Loop guards trip on [Pocomos]-prefixed latest entries
 *   - Customer ID lookup uses typed_custom_fields and falls back to flat
 *
 * Run:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/test-webhook.ts
 *
 * Optional second mode — fire at a live URL:
 *   TARGET_URL=http://localhost:3000/api/phoneburner/webhook \
 *   WEBHOOK_SECRET=$(grep WEBHOOK_SECRET .env.local | cut -d= -f2) \
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/test-webhook.ts live
 */
import {
  parseWebhook,
  parseLatestNoteEntry,
  isAutoDispositionNote,
  type PBCallDonePayload,
} from "../src/lib/sync/webhookProcessor";

const REAL_NOTE_HISTORY = [
  "-- 08/17/2021 @ 10:59 AM EDT -- (615) 265-0077 -- Voicemail Apt Setters sent.",
  "-- 03/19/2021 @ 11:52 AM -- Email sent: (615) 265-0077, no one answered when I called.",
  "-- 03/19/2021 @ 11:52 AM EDT -- (615) 265-0077 -- No Answer.",
].join("\n");

function payload(overrides: Partial<PBCallDonePayload> = {}): PBCallDonePayload {
  return {
    status: "Voicemail",
    duration: 47,
    recording_url_public: "https://recordings.phoneburner.com/abc123.mp3",
    recording_url: "https://internal.phoneburner.com/abc123.mp3",
    agent: { first_name: "Rena", last_name: "Shlomo" },
    contact: {
      user_id: "pb_contact_999",
      typed_custom_fields: [
        { type: 1, name: "Customer ID", value: "5913698" },
        { type: 1, name: "Other Field", value: "ignore me" },
      ],
      notes: REAL_NOTE_HISTORY,
    },
    ...overrides,
  };
}

function divider(label: string) {
  console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);
}

function showParsed(p: ReturnType<typeof parseWebhook>) {
  console.log(`pbContactId:           ${p.pbContactId}`);
  console.log(`pocomosId:             ${p.pocomosId}`);
  console.log(`disposition:           ${p.disposition}`);
  console.log(`duration:              ${p.duration}`);
  console.log(`csrName:               ${p.csrName}`);
  console.log(`recordingUrl:          ${p.recordingUrl}`);
  console.log(`noteBody:              ${JSON.stringify(p.noteBody)}`);
  console.log(`noteIsAutoDisposition: ${p.noteIsAutoDisposition}`);
  console.log(`skipReason:            ${p.skipReason ?? "(none)"}`);
  console.log(`pocomosSummary:`);
  console.log(p.pocomosSummary || "(empty — will not write)");
}

(async () => {
  // ── Unit checks ────────────────────────────────────────────────────────
  divider("UNIT — parseLatestNoteEntry only takes the first entry");
  const latest = parseLatestNoteEntry(REAL_NOTE_HISTORY);
  console.log("date:", latest?.date);
  console.log("body:", latest?.body);
  if (latest?.body !== "Voicemail Apt Setters sent.") {
    throw new Error(`expected body 'Voicemail Apt Setters sent.', got ${JSON.stringify(latest?.body)}`);
  }
  console.log("✓ first entry extracted, phone prefix stripped");

  divider("UNIT — isAutoDispositionNote");
  const checks: Array<[string, string, boolean]> = [
    ["Voicemail Apt Setters sent.", "Voicemail", true],
    ["No Answer.", "No Answer", true],
    ["Busy", "Busy", true],
    ["Customer wants to call back next Tuesday after 3pm", "Voicemail", false],
    ["", "Voicemail", true],
  ];
  for (const [body, dispo, expected] of checks) {
    const got = isAutoDispositionNote(body, dispo);
    console.log(`  body=${JSON.stringify(body).padEnd(60)} dispo=${dispo.padEnd(12)} → ${got} (want ${expected})`);
    if (got !== expected) throw new Error(`isAutoDispositionNote mismatch on ${JSON.stringify(body)}`);
  }
  console.log("✓ all heuristic cases pass");

  // ── End-to-end scenarios ───────────────────────────────────────────────
  divider("SCENARIO 1 — real PB shape, latest entry is auto-disposition (Voicemail Apt Setters sent.)");
  const a = parseWebhook(payload());
  showParsed(a);
  if (a.skipReason) throw new Error("should not skip — Customer ID present");
  if (!a.noteIsAutoDisposition) throw new Error("should detect auto-disposition");
  if (!a.pocomosSummary.includes("Notes: (none)")) throw new Error("should render 'Notes: (none)' when auto");
  if (!a.pocomosSummary.includes("Recording: https://recordings.phoneburner.com/abc123.mp3")) {
    throw new Error("should prefer recording_url_public");
  }
  if (!a.pocomosSummary.includes("CSR: Rena Shlomo")) throw new Error("should derive CSR from agent.first/last");
  console.log("\n✓ scenario passes");

  divider("SCENARIO 2 — CSR typed a real follow-up note (not auto-text)");
  const b = parseWebhook(
    payload({
      contact: {
        user_id: "pb_contact_999",
        typed_custom_fields: [{ type: 1, name: "Customer ID", value: "5913698" }],
        notes: [
          "-- 05/14/2026 @ 02:30 PM EDT -- (516) 555-1234 -- Customer wants to call back next Tuesday after 3pm to discuss pricing for full season",
          REAL_NOTE_HISTORY,
        ].join("\n"),
      },
      status: "Booked",
    })
  );
  showParsed(b);
  if (b.noteIsAutoDisposition) throw new Error("should NOT mark a real note as auto-disposition");
  if (!b.pocomosSummary.includes("Customer wants to call back")) throw new Error("should include real note body");
  console.log("\n✓ real notes get propagated, history is NOT included");

  divider("SCENARIO 3 — fallback to recording_url when public missing");
  const c = parseWebhook(payload({ recording_url_public: "", recording_url: "https://fallback.example/x.mp3" }));
  showParsed(c);
  if (!c.pocomosSummary.includes("https://fallback.example/x.mp3")) throw new Error("should use fallback URL");
  console.log("\n✓ fallback URL used");

  divider("SCENARIO 4 — Customer ID via flat custom_fields fallback");
  const d = parseWebhook(
    payload({
      contact: {
        user_id: "pb_contact_999",
        typed_custom_fields: [],
        custom_fields: { "Customer ID": "999888" },
        notes: REAL_NOTE_HISTORY,
      },
    })
  );
  showParsed(d);
  if (d.pocomosId !== "999888") throw new Error("should fall back to flat custom_fields");
  console.log("\n✓ flat custom_fields fallback works");

  divider("SCENARIO 5 — loop guard trips when latest entry starts with [Pocomos]");
  const e = parseWebhook(
    payload({
      contact: {
        user_id: "pb_contact_999",
        typed_custom_fields: [{ type: 1, name: "Customer ID", value: "5913698" }],
        notes: [
          "-- 05/14/2026 @ 12:00 PM EDT -- [Pocomos] 2026-05-14 — Account note from Pocomos side",
          REAL_NOTE_HISTORY,
        ].join("\n"),
      },
    })
  );
  showParsed(e);
  if (!e.skipReason || !/loop guard/.test(e.skipReason)) {
    throw new Error("should trip loop guard on [Pocomos]-prefixed latest entry");
  }
  if (e.pocomosSummary) throw new Error("should produce empty summary when skipping");
  console.log("\n✓ loop guard tripped");

  divider("SCENARIO 6 — missing Customer ID");
  const f = parseWebhook(
    payload({
      contact: {
        user_id: "pb_contact_999",
        typed_custom_fields: [{ type: 1, name: "Other Field", value: "x" }],
        notes: REAL_NOTE_HISTORY,
      },
    })
  );
  showParsed(f);
  if (!f.skipReason || !/Customer ID/.test(f.skipReason)) {
    throw new Error("should skip with Customer ID error");
  }
  console.log("\n✓ skips when Customer ID missing");

  // ── Optional live POST ─────────────────────────────────────────────────
  if (process.argv[2] === "live") {
    const target = process.env.TARGET_URL;
    const secret = process.env.WEBHOOK_SECRET;
    if (!target || !secret) {
      throw new Error("live mode requires TARGET_URL and WEBHOOK_SECRET env vars");
    }
    divider(`LIVE — POST to ${target}?secret=...`);
    const resp = await fetch(`${target}?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    console.log(`status: ${resp.status}`);
    console.log(`body:   ${await resp.text()}`);
  }

  divider("ALL CHECKS PASSED");
})().catch((e) => {
  console.error("\n✗ test-webhook FAILED:", e);
  process.exitCode = 1;
});
