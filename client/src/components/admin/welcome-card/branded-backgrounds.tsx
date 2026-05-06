/**
 * Branded SVG backgrounds for the MealScout welcome-card system.
 *
 * Per Thomas's locked brand rules:
 *   - Dark immersive base (#050505)
 *   - Glowing amber #f59e0b accents
 *   - No raster photos, no AI-scraped imagery in fallbacks
 *   - Each business category gets its own subtle vector motif so the card
 *     feels customized to that business type without inventing fake content.
 *
 * Designed to render at 1200x630 (Facebook OG / share-card export size) but
 * the SVGs use viewBox so they scale to any aspect ratio.
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
const BASE = "#050505";

/**
 * Shared dark canvas + grid + amber glow. All category-specific motifs render
 * on top of this so every card reads as part of the same family.
 */
const SharedCanvas = ({ children }: { children?: ReactNode }) => (
  <svg
    viewBox="0 0 1200 630"
    preserveAspectRatio="xMidYMid slice"
    className="absolute inset-0 h-full w-full"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      {/* Soft amber glow positioned right side (where right-card sits) */}
      <radialGradient id="amber-glow" cx="78%" cy="50%" r="55%">
        <stop offset="0%" stopColor={AMBER} stopOpacity="0.42" />
        <stop offset="55%" stopColor={AMBER_DEEP} stopOpacity="0.16" />
        <stop offset="100%" stopColor={BASE} stopOpacity="0" />
      </radialGradient>
      {/* Vignette to keep edges dark for text legibility */}
      <radialGradient id="vignette" cx="50%" cy="50%" r="78%">
        <stop offset="60%" stopColor={BASE} stopOpacity="0" />
        <stop offset="100%" stopColor={BASE} stopOpacity="0.55" />
      </radialGradient>
      {/* Top-to-bottom subtle gradient for depth */}
      <linearGradient id="depth" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#0a0a0a" />
        <stop offset="100%" stopColor="#000000" />
      </linearGradient>
      {/* Faint grid pattern to add texture without clutter */}
      <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse">
        <path
          d="M 72 0 L 0 0 0 72"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.05"
          strokeWidth="1"
        />
      </pattern>
    </defs>

    <rect width="1200" height="630" fill="url(#depth)" />
    <rect width="1200" height="630" fill="url(#grid)" />
    <rect width="1200" height="630" fill="url(#amber-glow)" />
    {children}
    <rect width="1200" height="630" fill="url(#vignette)" />
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────────
 * Category motifs.
 * Each motif is a single vector silhouette positioned subtly (low opacity,
 * lower-left or background) so it suggests the business type without
 * dominating the card.
 * ──────────────────────────────────────────────────────────────────────── */

const FoodTruckMotif = () => (
  <g opacity="0.18" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Stylized food truck silhouette, lower left */}
    <path d="M 70 470 L 70 360 L 380 360 L 430 410 L 540 410 L 540 470 Z" />
    <circle cx="160" cy="475" r="28" />
    <circle cx="450" cy="475" r="28" />
    <rect x="100" y="380" width="80" height="50" />
    <rect x="200" y="380" width="160" height="50" />
    {/* Steam puffs above */}
    <path d="M 200 340 q 10 -20 0 -40 q -10 -20 0 -40" />
    <path d="M 250 340 q 10 -20 0 -40 q -10 -20 0 -40" />
    <path d="M 300 340 q 10 -20 0 -40 q -10 -20 0 -40" />
  </g>
);

const RestaurantMotif = () => (
  <g opacity="0.18" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Plate + utensils, lower left */}
    <circle cx="220" cy="450" r="110" />
    <circle cx="220" cy="450" r="80" />
    {/* Fork */}
    <path d="M 360 360 L 360 450 M 350 360 L 350 400 M 370 360 L 370 400" />
    {/* Knife */}
    <path d="M 90 360 L 90 460 M 90 360 q -12 30 0 60" />
  </g>
);

const BarMotif = () => (
  <g opacity="0.20" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Cocktail glass, lower left */}
    <path d="M 130 360 L 320 360 L 230 470 Z" />
    <path d="M 230 470 L 230 540" />
    <path d="M 190 540 L 270 540" />
    {/* Bubbles */}
    <circle cx="200" cy="400" r="6" />
    <circle cx="240" cy="420" r="4" />
    <circle cx="260" cy="395" r="5" />
  </g>
);

const CatererMotif = () => (
  <g opacity="0.18" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Cloche (covered serving dome), lower left */}
    <path d="M 90 470 q 0 -120 150 -120 q 150 0 150 120 Z" />
    <circle cx="240" cy="345" r="6" fill={AMBER} />
    <line x1="60" y1="470" x2="420" y2="470" />
    {/* Steam */}
    <path d="M 200 320 q 10 -20 0 -40" />
    <path d="M 240 320 q 10 -20 0 -40" />
    <path d="M 280 320 q 10 -20 0 -40" />
  </g>
);

const PrivateChefMotif = () => (
  <g opacity="0.18" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Chef's hat, lower left */}
    <path d="M 130 470 L 130 400 q -50 -10 -30 -60 q 30 -50 80 -30 q 30 -60 100 -30 q 60 -10 60 50 q 30 30 -10 70 L 330 470 Z" />
    <line x1="130" y1="445" x2="330" y2="445" />
  </g>
);

const HostMotif = () => (
  <g opacity="0.18" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Marquee/venue silhouette, lower left */}
    <path d="M 80 470 L 80 360 L 200 320 L 320 360 L 320 470 Z" />
    <rect x="170" y="400" width="60" height="70" />
    <circle cx="200" cy="350" r="6" fill={AMBER} />
    {/* String lights */}
    <path d="M 60 280 q 100 40 200 0 q 100 -40 200 0" strokeDasharray="2 12" />
  </g>
);

const SupplierMotif = () => (
  <g opacity="0.18" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Crate stack, lower left */}
    <rect x="80" y="380" width="140" height="90" />
    <rect x="100" y="290" width="140" height="90" />
    <rect x="240" y="380" width="140" height="90" />
    <line x1="80" y1="425" x2="220" y2="425" />
    <line x1="150" y1="380" x2="150" y2="470" />
    <line x1="240" y1="425" x2="380" y2="425" />
    <line x1="310" y1="380" x2="310" y2="470" />
  </g>
);

const EventMotif = () => (
  <g opacity="0.20" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Calendar / ticket motif */}
    <rect x="80" y="320" width="280" height="180" rx="12" />
    <line x1="80" y1="370" x2="360" y2="370" />
    <line x1="140" y1="300" x2="140" y2="340" />
    <line x1="220" y1="300" x2="220" y2="340" />
    <line x1="300" y1="300" x2="300" y2="340" />
    <circle cx="220" cy="430" r="22" fill={AMBER} fillOpacity="0.4" />
  </g>
);

const CriticMotif = () => (
  <g opacity="0.22" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Quote marks + 5-star row, more editorial */}
    <text
      x="80"
      y="430"
      fontSize="220"
      fontFamily="Georgia, serif"
      fill={AMBER}
      fillOpacity="0.32"
    >
      &ldquo;
    </text>
    {/* 5 stars across bottom */}
    {[0, 1, 2, 3, 4].map((i) => (
      <polygon
        key={i}
        points="0,-12 3.5,-3.7 12,-3.7 5,2 7.5,11 0,5.5 -7.5,11 -5,2 -12,-3.7 -3.5,-3.7"
        transform={`translate(${250 + i * 40} 530) scale(1.2)`}
        fill={AMBER}
        fillOpacity="0.5"
        stroke="none"
      />
    ))}
  </g>
);

const DefaultMotif = () => (
  <g opacity="0.16" stroke={AMBER} strokeWidth="2" fill="none">
    {/* Map pin */}
    <path d="M 230 320 q -90 0 -90 90 q 0 80 90 150 q 90 -70 90 -150 q 0 -90 -90 -90 Z" />
    <circle cx="230" cy="410" r="28" />
  </g>
);

/* ─────────────────────────────────────────────────────────────────────────
 * Public component
 * ──────────────────────────────────────────────────────────────────────── */

export interface BrandedBackgroundProps {
  kind: BrandedBackgroundKind;
}

/**
 * Render the branded SVG background for a given welcome-card category.
 * Always positions absolutely inside its container; the consumer is
 * responsible for the wrapper dimensions and `position: relative`.
 */
export function BrandedBackground({ kind }: BrandedBackgroundProps) {
  const motif = (() => {
    switch (kind) {
      case "food_truck":
        return <FoodTruckMotif />;
      case "restaurant":
        return <RestaurantMotif />;
      case "bar":
        return <BarMotif />;
      case "caterer":
        return <CatererMotif />;
      case "private_chef":
        return <PrivateChefMotif />;
      case "host":
        return <HostMotif />;
      case "supplier":
        return <SupplierMotif />;
      case "event":
        return <EventMotif />;
      case "critic":
        return <CriticMotif />;
      default:
        return <DefaultMotif />;
    }
  })();

  return <SharedCanvas>{motif}</SharedCanvas>;
}

export default BrandedBackground;
