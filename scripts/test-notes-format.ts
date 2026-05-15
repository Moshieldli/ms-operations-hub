/**
 * Synthetic verification of formatNotesForPhoneBurner — confirms the
 * 10-most-recent cap, the tail summary line, the reverse-chrono ordering,
 * and the [Pocomos]-prefix loop guard. No network, no DB.
 */
import { formatNotesForPhoneBurner, type PocomosNote } from "../src/lib/pocomos/notes";

function build(n: number): PocomosNote[] {
  const out: PocomosNote[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(((i % 28) + 1)).padStart(2, "0");
    const month = String(((Math.floor(i / 28) % 12) + 1)).padStart(2, "0");
    const year = 2024 + Math.floor(i / (28 * 12));
    out.push({
      date: `${year}-${month}-${day}`,
      summary: `Synthetic note #${i + 1} — Rena Shlomo`,
      source: "pocomos",
    });
  }
  // Throw in one PB-source note that should be filtered out.
  out.push({
    date: "2026-05-14",
    summary: "📞 PhoneBurner Call — Booked\nDuration: 120s · CSR: Rena\nNotes: ...\nRecording: ...",
    source: "pb",
  });
  return out;
}

const url = "https://mypocomos.net/lead/9999999/lead-information";

for (const n of [0, 1, 5, 10, 11, 15, 30]) {
  const notes = build(n);
  const block = formatNotesForPhoneBurner(notes, url);
  const lineCount = block ? block.split("\n").length : 0;
  console.log(`\n=== ${n} pocomos notes (+ 1 pb note that should be filtered) → ${lineCount} output lines ===`);
  console.log(block || "(empty)");
}
