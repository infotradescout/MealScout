/**
 * Branded SVG backgrounds for the MealScout welcome-card system.
 *
 * Mission lens (locked in project instruction):
 *   MealScout exists to restore foot traffic. Every visual must say
 *   "I need to GO there" - not "I need to have this brought to me."
 *
 * Design intent for these backdrops:
 *   - Read like the inside of a place at 7pm: warm signage glow,
 *     a deep dark room behind it, a faint hand-painted feel.
 *   - No line-art vehicle/icon shapes. No commerce icons. No takeout bags.
 *   - The "motif" is a single oversized typographic word - the destination
 *     itself - sitting behind the headline like a vintage hand-painted
 *     wall sign or a marquee letter board.
 *   - The amber signage glow is positioned where the hero photo (or
 *     typographic poster) will sit, so light always feels like it is
 *     coming from the place.
 *
 * Visible per category:
 *   food_truck   -> "TRUCK"      (vintage block caps, marquee placement)
 *   restaurant   -> "DINER"      (deli-counter wall lettering)
 *   bar          -> "BAR"        (neon sign vibe)
 *   caterer      -> "KITCHEN"    (commercial kitchen sign)
 *   private_chef -> "CHEF"       (intimate counter)
 *   host         -> "VENUE"      (marquee letter board)
 *   supplier     -> "SUPPLY"     (warehouse painted sign)
 *   event        -> "TONIGHT"    (poster-board headline)
 *   critic       -> "ON THE BEAT" (press / column header)
 *   default      -> "MEALSCOUT"  (brand fallback)
 *
 * Amber #f59e0b is the brand spine. Theme picker (Round 3b) will swap
 * the AMBER constant via a prop later; for now it's the locked default.
 */
import type { ReactNode } from "react";

export type BrandedBackgroundKind =
  | "food_truck"
  | "restaurant"
  | "bar"
  | "caterer"
  | "private_chef"
  | "host"
  | "supplier"
  | "event"
  | "critic"
  | "default";

const AMBER = "#f59e0b";
const AMBER_DEEP = "#b45309";
const AMBER_HOT = "#fbbf24";
const BASE = "#050505";
const ROOM = "#0a0808";

/** Map each kind to its destination word + tagline kicker. */
const MOTIF: Record<
  BrandedBackgroundKind,
  { word: string; subWord?: string }
> = {
  food_truck: { word: "TRUCK", subWord: "PARKED" },
  restaurant: { word: "DINER", subWord: "OPEN" },
  bar: { word: "BAR", subWord: "TONIGHT" },
  caterer: { word: "KITCHEN", subWord: "ON" },
  private_chef: { word: "CHEF", subWord: "AT THE PASS" },
  host: { word: "VENUE", subWord: "DOORS OPEN" },
  supplier: { word: "SUPPLY", subWord: "STOCKED" },
  event: { word: "TONIGHT", subWord: "DOORS AT" },
  critic: { word: "ON THE BEAT", subWord: "REVIEWS" },
  default: { word: "MEALSCOUT", subWord: "FOLLOW THE FLAVOR" },
};

/**
 * Shared atmospheric canvas:
 *   - deep room base
 *   - warm vignette (signage glow felt from the right side)
 *   - subtle film grain (turbulence)
 *   - faint horizontal "marquee bulb row" along the top edge
 *
 * Children (the typographic motif) render between the room and the grain
 * so the word feels painted onto the wall but not on top of the photo.
 */
const SharedCanvas = ({ children }: { children?: ReactNode }) => (
  <svg
    viewBox="0 0 1200 630"
    preserveAspectRatio="xMidYMid slice"
    className="pointer-events-none absolute inset-0 h-full w-full"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      {/* Deep room base */}
      <linearGradient id="ms-room" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={ROOM} />
        <stop offset="100%" stopColor={BASE} />
      </linearGradient>

      {/* Warm signage glow on the right where the hero panel sits */}
      <radialGradient id="ms-amber-glow" cx="78%" cy="42%" r="70%">
        <stop offset="0%" stopColor={AMBER_HOT} stopOpacity="0.34" />
        <stop offset="32%" stopColor={AMBER} stopOpacity="0.22" />
        <stop offset="62%" stopColor={AMBER_DEEP} stopOpacity="0.12" />
        <stop offset="100%" stopColor={BASE} stopOpacity="0" />
      </radialGradient>

      {/* Cooler counter-light from the left so the brand panel reads */}
      <radialGradient id="ms-counter" cx="14%" cy="78%" r="55%">
        <stop offset="0%" stopColor="#1a0f06" stopOpacity="0.55" />
        <stop offset="100%" stopColor={BASE} stopOpacity="0" />
      </radialGradient>

      {/* Subtle hand-painted film grain */}
      <filter id="ms-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="2"
          seed="7"
        />
        <feColorMatrix
          values="0 0 0 0 0.9 0 0 0 0 0.7 0 0 0 0 0.4 0 0 0 0.06 0"
        />
      </filter>

      {/* Marquee bulb row pattern - tiny dots across the top */}
      <pattern
        id="ms-marquee-bulbs"
        x="0"
        y="0"
        width="36"
        height="36"
        patternUnits="userSpaceOnUse"
      >
        <circle cx="18" cy="18" r="2.4" fill={AMBER} opacity="0.55" />
        <circle cx="18" cy="18" r="5.2" fill={AMBER_HOT} opacity="0.18" />
      </pattern>
    </defs>

    {/* Layer order: room -> counter light -> amber signage glow -> motif -> bulbs -> grain */}
    <rect width="1200" height="630" fill="url(#ms-room)" />
    <rect width="1200" height="630" fill="url(#ms-counter)" />
    <rect width="1200" height="630" fill="url(#ms-amber-glow)" />

    {children}

    {/* Top marquee bulb strip (subtle - signage cue) */}
    <rect width="1200" height="36" fill="url(#ms-marquee-bulbs)" opacity="0.42" />

    {/* Hand-painted noise overlay (very faint - just enough to kill the flat-app feel) */}
    <rect width="1200" height="630" filter="url(#ms-grain)" opacity="0.55" />
  </svg>
);

/**
 * The category-specific oversized destination word, painted huge across
 * the canvas behind everything. Reads like a vintage wall sign.
 *
 * Positioning notes:
 *   - Sits roughly where the hero panel will be (right ~60%)
 *   - Vertically anchored at ~52% so the headline above it reads first
 *   - Stroke + low opacity so it never competes with the headline
 */
const DestinationWord = ({ kind }: { kind: BrandedBackgroundKind }) => {
  const motif = MOTIF[kind] ?? MOTIF.default;
  const { word, subWord } = motif;

  // Word size tunes down for very long words so it never wraps
  const fontSize = word.length > 10 ? 158 : word.length > 7 ? 196 : 240;

  return (
    <g aria-hidden="true">
      {/* Massive ghosted destination word - the room's signage */}
      <text
        x="640"
        y="380"
        textAnchor="middle"
        fontFamily="'Bebas Neue', 'Impact', sans-serif"
        fontSize={fontSize}
        fontWeight="400"
        letterSpacing="14"
        fill={AMBER}
        fillOpacity="0.10"
        stroke={AMBER}
        strokeOpacity="0.32"
        strokeWidth="1.4"
      >
        {word}
      </text>

      {/* Tiny subkicker under the word - reads like a hand-stenciled label */}
      {subWord ? (
        <text
          x="640"
          y="430"
          textAnchor="middle"
          fontFamily="'Bebas Neue', 'Impact', sans-serif"
          fontSize="22"
          letterSpacing="14"
          fill={AMBER_HOT}
          fillOpacity="0.55"
        >
          {subWord}
        </text>
      ) : null}
    </g>
  );
};

interface BrandedBackgroundProps {
  kind: BrandedBackgroundKind;
}

const BrandedBackground = ({ kind }: BrandedBackgroundProps) => (
  <SharedCanvas>
    <DestinationWord kind={kind} />
  </SharedCanvas>
);

export default BrandedBackground;
