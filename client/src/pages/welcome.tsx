import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";

export default function Welcome() {
  return (
    <>
      <SEOHead
        title="Welcome to MealScout"
        description="Find live food trucks, deals, and what's happening in your local food scene. Log in or create your free account."
      />

      <main
        className="relative min-h-[100dvh] w-full overflow-hidden bg-[#050608] text-white"
        data-testid="welcome-landing"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage:
              "url('/atmospheric/mealscout-welcome-map-night.png')",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.22)_0%,rgba(0,0,0,0.43)_46%,rgba(0,0,0,0.72)_100%)]"
        />

        <section className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-6 py-10 text-center">
          <img
            src="/brand/mealscout-logo-pin.png"
            alt="MealScout"
            className="mb-8 h-auto w-48 max-w-[62vw] drop-shadow-[0_4px_26px_rgba(0,0,0,0.72)]"
          />

          <div className="flex w-full max-w-[18rem] flex-col gap-3">
            <Link
              href="/customer-signup"
              className="inline-flex h-12 items-center justify-center rounded-full bg-amber-400 px-6 text-[15px] font-black text-black shadow-[0_0_26px_rgba(245,158,11,0.36)] transition hover:bg-amber-300 active:scale-[0.98]"
            >
              Sign up
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/25 bg-black/38 px-6 text-[15px] font-black text-white backdrop-blur-md transition hover:bg-white/12 active:scale-[0.98]"
            >
              Log in
            </Link>
          </div>

          <p className="mt-7 text-base font-semibold italic text-white/88 drop-shadow-[0_2px_16px_rgba(0,0,0,0.85)]">
            Follow The Flavor.
          </p>
        </section>
      </main>
    </>
  );
}
