import { PartyPopper, Trophy } from "lucide-react";

/**
 * Inline status icons (rev 45) — the SVG replacements for the last 🎉 / 🏆 emoji
 * on the browser dashboard pages, matching the emoji-free TV boards. Sized to
 * sit inline with text.
 */

/** All-clear / nothing-to-do celebration (was 🎉). Emerald = healthy. */
export function AllClearIcon({ className = "" }: { className?: string }) {
  return (
    <PartyPopper
      className={`inline h-[1.1em] w-[1.1em] align-text-bottom text-emerald-600 dark:text-emerald-400 ${className}`}
      aria-hidden="true"
    />
  );
}

/** Leaderboard trophy (was 🏆). Amber/gold, matching the TV referral trophy. */
export function TrophyIcon({ className = "" }: { className?: string }) {
  return (
    <Trophy
      className={`inline h-[1.1em] w-[1.1em] align-text-bottom text-amber-500 ${className}`}
      aria-hidden="true"
    />
  );
}
