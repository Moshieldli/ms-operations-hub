import {
  Cloud,
  CloudDrizzle,
  Droplet,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Map as MapIcon,
  Medal,
  Shield,
  Star,
  Snowflake,
  Sun,
  Target,
  Trophy,
  Thermometer,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon system for the shop TVs (rev 35) — inline SVG, never emoji.
 *
 * WHY: Yodeck's Linux browser ships no color-emoji font, so 🎯🛡️⚡🗺️📈🏅 and the
 * weather glyphs rendered as empty boxes (tofu) on the actual screens while
 * looking perfect in every desktop browser we tested. An SVG is geometry, not a
 * font lookup, so it renders identically everywhere. The emoji fields are gone
 * from the data layer entirely (`AwardDef.emoji`, `ForecastDay.emoji`) rather
 * than merely unused here — that's what makes "zero emoji codepoints in the
 * DOM" a property of the system instead of a thing we keep remembering.
 *
 * SIZING: everything is driven by the `size` prop in whatever unit the caller
 * passes (the tall board passes `em`, so icons scale with the measured tile
 * type; the landscape board passes `rem`). Nothing here assumes a viewport.
 */

/** One accent per award — matched to the award's meaning, not its position. */
const AWARD_ICONS: Record<string, { Icon: LucideIcon; accent: string }> = {
  "clean-streak": { Icon: Target, accent: "#f472b6" }, // pink — hitting the mark
  "iron-wall": { Icon: Shield, accent: "#60a5fa" }, // blue — defense
  workhorse: { Icon: Zap, accent: "#fbbf24" }, // amber — raw energy
  "road-warrior": { Icon: MapIcon, accent: "#4ade80" }, // green — ground covered
  "most-improved": { Icon: TrendingUp, accent: "#2dd4bf" }, // teal — upward trend
  "perfect-week": { Icon: Medal, accent: "#fcd34d" }, // gold — the medal
  // The referral trophy (rev 41) — gold, top billing, the only spinning icon.
  referral: { Icon: Trophy, accent: "#fbbf24" },
};

/** Fallback keeps an unknown//future award (e.g. the deferred referral trophy) legible. */
const FALLBACK = { Icon: Medal, accent: "#cbd5e1" };

export function awardAccent(id: string): string {
  return (AWARD_ICONS[id] ?? FALLBACK).accent;
}

/**
 * An award icon in a gradient badge with a soft glow.
 *
 * Colors are INLINE, not Tailwind classes: a dynamic `text-${color}-400` would
 * be purged at build time and silently render colorless on the TV, which is the
 * same class of invisible-in-production failure the emoji itself was.
 */
export function AwardIcon({ id, size = "1em" }: { id: string; size?: string }) {
  const { Icon, accent } = AWARD_ICONS[id] ?? FALLBACK;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Glow — sits outside the badge so it reads as light, not a border. */}
      <span
        className="absolute rounded-full"
        style={{
          inset: "-14%",
          background: `radial-gradient(circle, ${accent}66 0%, ${accent}1f 45%, transparent 72%)`,
        }}
      />
      {/* Badge disc — a lit top-left edge gives it dimension at a distance. */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: `linear-gradient(145deg, ${accent}3d 0%, ${accent}14 55%, ${accent}08 100%)`,
          boxShadow: `inset 0 0 0 1px ${accent}59, inset 0 1px 2px ${accent}40`,
        }}
      />
      <Icon
        style={{ width: "56%", height: "56%", color: accent, position: "relative" }}
        strokeWidth={2.25}
        absoluteStrokeWidth
      />
    </span>
  );
}

/**
 * The BOOSTED star (rev 41) — a tech inside his referral celebration month
 * carries this on every tile he wins, not just the trophy. Filled gold so it
 * reads instantly across a room without needing the label.
 */
export function BoostStar({ size = "1em" }: { size?: string }) {
  return (
    <Star
      style={{ width: size, height: size, color: "#fbbf24", fill: "#fbbf24" }}
      strokeWidth={2}
      absoluteStrokeWidth
      aria-hidden="true"
    />
  );
}

/** The 💧 that used to sit beside the precipitation %. Inherits `currentColor`. */
export function PrecipIcon({ size = "1em" }: { size?: string }) {
  return (
    <Droplet
      style={{ width: size, height: size, fill: "currentColor" }}
      strokeWidth={2}
      absoluteStrokeWidth
      aria-hidden="true"
    />
  );
}

/**
 * WMO weather code → icon + tint. Same bands the old emoji map used (clear,
 * cloud, fog, drizzle, rain, snow, storm) so the strip reads the same, just
 * font-independently. Tints stay in the board's cool palette; only genuinely
 * "watch out" states (storm) go warm.
 */
function weatherFor(code: number): { Icon: LucideIcon; accent: string } {
  if (code === 0) return { Icon: Sun, accent: "#fbbf24" };
  if (code === 1 || code === 2) return { Icon: CloudSun, accent: "#fcd34d" };
  if (code === 3) return { Icon: Cloud, accent: "#cbd5e1" };
  if (code === 45 || code === 48) return { Icon: CloudFog, accent: "#94a3b8" };
  if (code >= 51 && code <= 57) return { Icon: CloudDrizzle, accent: "#7dd3fc" };
  if (code >= 61 && code <= 67) return { Icon: CloudRain, accent: "#38bdf8" };
  if (code >= 71 && code <= 77) return { Icon: Snowflake, accent: "#e0f2fe" };
  if (code >= 80 && code <= 82) return { Icon: CloudRain, accent: "#38bdf8" };
  if (code === 85 || code === 86) return { Icon: CloudSnow, accent: "#e0f2fe" };
  if (code >= 95) return { Icon: CloudLightning, accent: "#f59e0b" };
  return { Icon: Thermometer, accent: "#cbd5e1" };
}

/**
 * A weather glyph. Unbadged by design — the strip is a dense row of four, and
 * six competing badge discs would fight the award wall below it for attention.
 * It keeps a soft glow so it still reads as lit on the dark board.
 */
export function WeatherIcon({ code, size = "1em" }: { code: number; size?: string }) {
  const { Icon, accent } = weatherFor(code);
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="absolute rounded-full"
        style={{
          inset: "8%",
          background: `radial-gradient(circle, ${accent}3d 0%, transparent 68%)`,
        }}
      />
      <Icon
        style={{ width: "100%", height: "100%", color: accent, position: "relative" }}
        strokeWidth={2}
        absoluteStrokeWidth
      />
    </span>
  );
}
