/**
 * welcome.tsx
 * Logged-out landing screen at /
 *
 * Rules:
 * - Two CTAs only: Sign up + Log in
 * - Atmospheric dark UI: glassmorphism, amber glow, Playfair Display headline
 * - CSSMapHero as full-screen background (real Carto tiles, amber neon style)
 * - Tagline: "Follow The Flavor." — no alternates
 * - No delivery, no ordering, no takeout language
 * - Logged-in users are redirected to /explore-preview by App.tsx before this renders
 */

import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { MapPin, Navigation } from "lucide-react";
import { SEOHead } from "@/components/seo-head";

/* ─── Tile math ─────────────────────────────────────────────────────────── */

const ZOOM = 14;
const TILE_SIZE = 256;

function lngToTileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
}
function tileToLng(x: number, z: number) {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tileToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/* ─── Static fallback coords (Pensacola, FL) ────────────────────────────── */
const FALLBACK = { lat: 30.4213, lng: -87.2169 };

/* ─── CSSMapHero (inline — same logic as explore-preview) ───────────────── */

function WelcomeMapBackground() {
  const coords = FALLBACK; // static for welcome screen — no location needed

  const { tiles, userPinLeft, userPinTop } = useMemo(() => {
    const { lat, lng } = coords;
    const cx = lngToTileX(lng, ZOOM);
    const cy = latToTileY(lat, ZOOM);

    // Sub-tile offset so user pin is exactly centered
    const tileLng0 = tileToLng(cx, ZOOM);
    const tileLng1 = tileToLng(cx + 1, ZOOM);
    const tileLat0 = tileToLat(cy, ZOOM);
    const tileLat1 = tileToLat(cy + 1, ZOOM);
    const subX = (lng - tileLng0) / (tileLng1 - tileLng0);
    const subY = (lat - tileLat0) / (tileLat1 - tileLat0);

    // 3×3 grid centered on user tile
    const grid: { url: string; col: number; row: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        grid.push({
          url: `https://a.basemaps.cartocdn.com/dark_all/${ZOOM}/${tx}/${ty}.png`,
          col: dx + 1,
          row: dy + 1,
        });
      }
    }

    // User pin position as % of the 3×3 canvas
    const pinLeft = ((1 + subX) / 3) * 100;
    const pinTop = ((1 + subY) / 3) * 100;

    return { tiles: grid, userPinLeft: pinLeft, userPinTop: pinTop };
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ perspective: "900px" }}
    >
      {/* Perspective tilt plane */}
      <div
        className="absolute inset-0"
        style={{
          transform: "rotateX(48deg) rotateZ(-6deg) scale(1.55)",
          transformOrigin: "50% 60%",
          animation: "mapBreathe 20s ease-in-out infinite",
        }}
      >
        {/* 3×3 tile grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: "repeat(3, 33.333%)",
            gridTemplateRows: "repeat(3, 33.333%)",
          }}
        >
          {tiles.map((t) => (
            <img
              key={`${t.col}-${t.row}`}
              src={t.url}
              alt=""
              draggable={false}
              style={{
                gridColumn: t.col + 1,
                gridRow: t.row + 1,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter:
                  "brightness(1.7) contrast(1.15) saturate(0.6)",
              }}
            />
          ))}
        </div>

        {/* Neon street glow — screen blend on bright road pixels */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(249,115,22,0.18) 0%, transparent 70%)",
            mixBlendMode: "screen",
            filter: "blur(8px)",
            pointerEvents: "none",
          }}
        />

        {/* User location pin */}
        <div
          style={{
            position: "absolute",
            left: `${userPinLeft}%`,
            top: `${userPinTop}%`,
            transform: "translate(-50%, -50%)",
            zIndex: 10,
          }}
        >
          {/* Outer pulse ring */}
          <div
            style={{
              position: "absolute",
              inset: "-14px",
              borderRadius: "50%",
              border: "2px solid rgba(249,115,22,0.5)",
              animation: "pinPulse 2.4s ease-out infinite",
            }}
          />
          {/* Inner glow */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "radial-gradient(circle, #fb923c 0%, #f97316 60%, rgba(249,115,22,0.3) 100%)",
              boxShadow: "0 0 18px 6px rgba(249,115,22,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Navigation
              style={{ width: 13, height: 13, color: "#fff", fill: "#fff" }}
            />
          </div>
        </div>
      </div>

      {/* Dark vignette — bottom heavy so content reads */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(8,10,15,0.55) 0%, rgba(8,10,15,0.20) 30%, rgba(8,10,15,0.65) 65%, rgba(8,10,15,0.96) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Keyframes injected inline */}
      <style>{`
        @keyframes mapBreathe {
          0%,100% { transform: rotateX(48deg) rotateZ(-6deg) scale(1.55); }
          50%      { transform: rotateX(49.5deg) rotateZ(-6deg) scale(1.55); }
        }
        @keyframes pinPulse {
          0%   { transform: scale(0.6); opacity: 0.9; }
          70%  { transform: scale(1.8); opacity: 0; }
          100% { transform: scale(0.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/* ─── Welcome page ──────────────────────────────────────────────────────── */

export default function Welcome() {
  // Ensure page starts at top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <SEOHead
        title="MealScout — Follow The Flavor."
        description="Discover live local food trucks, restaurants, and deals near you. MealScout puts the best local food scene right in your pocket."
      />

      {/* Full-viewport dark base */}
      <div className="fixed inset-0 bg-[#080a0f]" aria-hidden="true" />

      {/* Map background */}
      <div className="fixed inset-0 z-0">
        <WelcomeMapBackground />
      </div>

      {/* Content layer */}
      <main className="relative z-10 min-h-screen flex flex-col">

        {/* Top logo bar */}
        <div
          className="flex items-center justify-between px-5"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center"
              style={{
                background: "radial-gradient(circle, #f97316 0%, #d97706 100%)",
                boxShadow: "0 0 14px rgba(249,115,22,0.55)",
              }}
            >
              <MapPin className="h-4 w-4 text-white" aria-hidden="true" />
            </div>
            <span
              className="text-white font-bold tracking-widest uppercase text-sm"
              style={{ letterSpacing: "0.18em" }}
            >
              MealScout
            </span>
          </div>

          <Link
            href="/login"
            className="text-sm font-semibold text-amber-300 hover:text-amber-200 transition-colors"
          >
            Log in
          </Link>
        </div>

        {/* Spacer — pushes headline to lower third */}
        <div className="flex-1" />

        {/* Hero copy + CTAs */}
        <div className="px-6 pb-16" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)" }}>

          {/* Location chip */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/15 mb-5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "#f97316", boxShadow: "0 0 6px #f97316" }}
              aria-hidden="true"
            />
            <span className="text-[11px] font-semibold text-white/80 uppercase tracking-widest">
              Live Near You
            </span>
          </div>

          {/* Headline */}
          <h1
            className="text-white leading-none mb-3"
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: "clamp(2.6rem, 10vw, 4rem)",
              fontWeight: 700,
              textShadow: "0 2px 24px rgba(0,0,0,0.7)",
            }}
          >
            Follow The Flavor.
          </h1>

          {/* Sub-headline */}
          <p
            className="text-white/60 text-base leading-relaxed mb-8 max-w-xs"
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}
          >
            Community-powered discovery for the local food scene — trucks, spots, and deals happening right now.
          </p>

          {/* CTAs */}
          <div className="flex flex-col gap-3 max-w-sm">
            <Link
              href="/customer-signup"
              className="w-full flex items-center justify-center h-14 rounded-2xl font-bold text-base text-white transition-all active:scale-[0.97]"
              style={{
                background: "linear-gradient(135deg, #f97316 0%, #d97706 100%)",
                boxShadow: "0 4px 24px rgba(249,115,22,0.45), 0 1px 0 rgba(255,255,255,0.12) inset",
              }}
            >
              Sign up free
            </Link>

            <Link
              href="/login"
              className="w-full flex items-center justify-center h-14 rounded-2xl font-semibold text-base text-white/90 transition-all active:scale-[0.97] bg-white/10 backdrop-blur-md ring-1 ring-white/20 hover:bg-white/15"
            >
              Log in
            </Link>
          </div>

          {/* Fine print */}
          <p className="mt-5 text-center text-[11px] text-white/35 max-w-xs mx-auto">
            No delivery. No fees. Just the real local food scene.
          </p>
        </div>
      </main>
    </>
  );
}
