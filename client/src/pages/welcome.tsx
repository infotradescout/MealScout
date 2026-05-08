import { useEffect } from "react";
import { Link } from "wouter";
import { Compass, HeartHandshake, MapPinned, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Welcome() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#07090b] text-white"
      data-testid="welcome-landing"
    >
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#f59f00]/20 blur-[120px]" />
        <div className="absolute bottom-[-180px] left-[-120px] h-[430px] w-[430px] rounded-full bg-[#ff6b00]/16 blur-[110px]" />
        <div className="absolute right-[-140px] top-1/3 h-[360px] w-[360px] rounded-full bg-[#ffd166]/10 blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,209,102,0.09),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.06)_0,transparent_28%,rgba(255,159,0,0.07)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black via-black/70 to-transparent" />
      </div>

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="group inline-flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f8c537]/35 bg-[#111418] shadow-[0_0_30px_rgba(245,159,0,0.24)]">
              <Compass className="h-5 w-5 text-[#f8c537]" aria-hidden="true" />
            </span>
            <span className="leading-none">
              <span className="block text-lg font-black tracking-[0.22em] text-white">
                MEALSCOUT
              </span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.32em] text-[#f8c537]/80">
                Local food radar
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-3 sm:flex">
            <Button
              asChild
              variant="ghost"
              className="rounded-full border border-white/10 bg-white/[0.03] px-5 text-white hover:bg-white/10"
            >
              <Link href="/login">Log in</Link>
            </Button>
            <Button
              asChild
              className="rounded-full bg-[#f8c537] px-5 font-black text-black shadow-[0_0_28px_rgba(248,197,55,0.32)] hover:bg-[#ffd966]"
            >
              <Link href="/customer-signup">Sign up free</Link>
            </Button>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#f8c537]/25 bg-[#f8c537]/10 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-[#f8c537]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Scout what is cooking nearby
            </div>

            <h1 className="font-black leading-[0.88] tracking-[-0.06em] text-[clamp(4rem,13vw,10rem)]">
              Follow
              <span className="block text-[#f8c537]">The Flavor.</span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg font-semibold leading-8 text-white/72 sm:text-xl">
              MealScout is your local dashboard for food trucks, independent
              restaurants, deals, live pop-ups, parking hosts, and the little
              food moments most apps miss.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-14 rounded-full bg-[#f8c537] px-8 text-base font-black text-black shadow-[0_0_32px_rgba(248,197,55,0.35)] hover:bg-[#ffd966]"
                data-testid="welcome-signup"
              >
                <Link href="/customer-signup">Sign up free</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 rounded-full border-white/15 bg-white/[0.04] px-8 text-base font-black text-white hover:bg-white/10 hover:text-white"
                data-testid="welcome-login"
              >
                <Link href="/login">Log in</Link>
              </Button>
            </div>

            <p className="mt-5 text-sm font-medium text-white/45">
              Built for real local discovery: trucks, menus, hosts, events, and
              neighborhood favorites in one place.
            </p>
          </div>

          <aside className="relative mx-auto w-full max-w-md lg:ml-auto">
            <div className="absolute -inset-5 rounded-[2rem] bg-[#f8c537]/14 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#111418]/86 p-5 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/26 p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-[#f8c537]/75">
                      Tonight's radar
                    </p>
                    <p className="mt-1 text-2xl font-black">Local food pulse</p>
                  </div>
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f8c537] text-black">
                    <MapPinned className="h-6 w-6" aria-hidden="true" />
                  </span>
                </div>

                <div className="space-y-3">
                  {[
                    ["Live trucks", "Find who is open and where they are parked."],
                    ["Menu previews", "Peek at dishes before you choose a spot."],
                    ["Parking hosts", "See places that welcome food trucks."],
                    ["Saved spots", "Keep your favorite local finds close."],
                  ].map(([title, body]) => (
                    <div
                      key={title}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                    >
                      <div className="flex items-start gap-3">
                        <HeartHandshake
                          className="mt-0.5 h-5 w-5 shrink-0 text-[#f8c537]"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="font-black text-white">{title}</p>
                          <p className="mt-1 text-sm font-medium leading-5 text-white/55">
                            {body}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
