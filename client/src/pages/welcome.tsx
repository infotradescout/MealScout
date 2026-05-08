import { useLocation as useWouterLocation } from "wouter";
import { ArrowRight, LogIn } from "lucide-react";

import { SEOHead } from "@/components/seo-head";

/**
 * /  (logged-out only) — Welcome to MealScout
 *
 * Atmospheric UI gateway screen. The only goal here is to give returning
 * logged-out users a clear way to log in, and new users a clear way to
 * sign up. Sign up routes to the existing Choose Account Type screen
 * (/customer-signup). Log in routes to /login.
 *
 * No food-park, kitchen, vendor, menu, location, testimonial, metric, or
 * pricing assumptions are made on this screen — only brand + the two CTAs.
 */
export default function Welcome() {
  const [, navigate] = useWouterLocation();

  return (
    <>
      <SEOHead
        title="Welcome to MealScout"
        description="Find live food trucks, deals, and what's happening in your local food scene. Log in or create your free account."
      />

      {/* Solid black base so the lower band is true-black and the hero
          photo carries the top half of the screen. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 pointer-events-none bg-[#0a0c10]"
      />

      <main
        className="relative z-10 min-h-[100dvh] flex flex-col"
        data-testid="welcome-landing"
      >
        {/* HERO BAND — full-bleed atmospheric food-park photo with
            brand eyebrow, headline, and the two CTAs anchored below. */}
        <section className="relative w-full flex-1 flex flex-col">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "url('/atmospheric/mealscout-welcome-map-night.png')",
              backgroundSize: "cover",
              backgroundPosition: "center center",
              backgroundRepeat: "no-repeat",
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(8,10,15,0.45) 0%, rgba(8,10,15,0.10) 30%, rgba(8,10,15,0.55) 70%, rgba(10,12,16,0.98) 100%)",
            }}
          />

          {/* Top brand strip */}
          <div
            className="relative px-5"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)",
            }}
          >
            <p className="text-[11px] tracking-[0.32em] text-white/85 uppercase font-medium">
              MealScout
            </p>
          </div>

          {/* Hero content (headline + CTAs anchored to bottom of band) */}
          <div className="relative px-5 pt-6 pb-10 flex-1 flex flex-col">
            <div className="mt-8 sm:mt-12">
              <h1
                className="text-white font-extrabold leading-[0.95] tracking-tight text-[52px] sm:text-[64px] md:text-[72px]"
                style={{
                  fontFamily:
                    "'Playfair Display', 'Cormorant Garamond', Georgia, serif",
                  textShadow: "0 2px 28px rgba(0,0,0,0.65)",
                }}
              >
                Welcome to
                <br />
                MealScout.
              </h1>
              <p className="mt-4 text-white/90 text-base sm:text-lg max-w-md italic">
                Follow The Flavor.
              </p>
            </div>

            {/* CTA stack — pinned to the bottom of the hero band */}
            <div className="mt-auto pt-12 space-y-3">
              <button
                type="button"
                onClick={() => navigate("/customer-signup")}
                aria-label="Create your free MealScout account"
                className="w-full inline-flex items-center justify-between gap-3 h-14 px-6 rounded-full text-amber-100 font-semibold text-base sm:text-lg bg-black/55 backdrop-blur-md atmo-glow-amber ring-1 ring-amber-300/60"
              >
                <span className="flex items-center gap-3">
                  <span
                    className="h-9 w-9 rounded-full bg-amber-400/15 ring-1 ring-amber-300/50 flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <ArrowRight className="h-4 w-4 text-amber-200" />
                  </span>
                  Sign up
                </span>
                <span className="text-amber-200/80 text-sm font-medium">
                  Free
                </span>
              </button>

              <button
                type="button"
                onClick={() => navigate("/login")}
                aria-label="Log in to your MealScout account"
                className="w-full inline-flex items-center justify-center gap-3 h-14 px-6 rounded-full text-white font-semibold text-base sm:text-lg bg-white/5 backdrop-blur-md ring-1 ring-white/20 hover:bg-white/10 transition-colors"
              >
                <LogIn className="h-5 w-5 text-white/85" aria-hidden="true" />
                Log in
              </button>

              <div className="pt-3 text-center">
                <button
                  type="button"
                  onClick={() => navigate("/scout")}
                  className="text-sm text-white/70 underline underline-offset-4 hover:text-white"
                >
                  Browse without an account
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
