import { CalendarDays, MapPin, Store, Truck } from "lucide-react";
import { useLocation } from "wouter";

import { Button } from "@/components/ui/button";

type MealScoutPurpose = "foodie" | "owner" | "host" | "booker";

const purposeRoutes: Record<MealScoutPurpose, string> = {
  foodie: "/find-food/location",
  owner: "/truck-onboarding",
  host: "/host/start",
  booker: "/book/start",
};

const purposeCards: Array<{
  purpose: MealScoutPurpose;
  title: string;
  description: string;
  action: string;
  icon: typeof MapPin;
}> = [
  {
    purpose: "foodie",
    title: "Find food near me",
    description:
      "Open the fastest path to live trucks, deals, menus, and the map.",
    action: "Start eating",
    icon: MapPin,
  },
  {
    purpose: "owner",
    title: "List my food truck",
    description:
      "Claim or create your truck profile, add a menu, then go live.",
    action: "Start setup",
    icon: Truck,
  },
  {
    purpose: "host",
    title: "Host food trucks",
    description:
      "Add a location, set availability, and let trucks book or express interest in your spot.",
    action: "Add my spot",
    icon: Store,
  },
  {
    purpose: "booker",
    title: "Book a truck",
    description:
      "Request one truck or gather trucks for an event without digging through tools.",
    action: "Request trucks",
    icon: CalendarDays,
  },
];

export default function PurposeSelector() {
  const [, setLocation] = useLocation();

  const choosePurpose = (purpose: MealScoutPurpose) => {
    try {
      localStorage.setItem("mealscout:selectedPurpose", purpose);
    } catch {
      // Ignore storage failures; navigation still works.
    }
    setLocation(purposeRoutes[purpose]);
  };

  return (
    <main className="min-h-screen px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8 text-[color:var(--text-primary)] sm:px-6 sm:py-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-black/70 p-5 shadow-clean-lg backdrop-blur sm:p-8">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[color:var(--accent-text)]">
            MealScout start
          </p>
          <h1 className="text-3xl font-black leading-tight sm:text-5xl">
            How can MealScout help?
          </h1>
          <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
            Choose one path. MealScout will take you to the right first step
            instead of dropping you into every tool at once.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {purposeCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.purpose}
                type="button"
                onClick={() => choosePurpose(card.purpose)}
                className="group rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 p-4 text-left shadow-clean transition hover:-translate-y-0.5 hover:border-[color:var(--accent-text)]/70 hover:shadow-clean-lg"
              >
                <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--accent-text)]/15 text-[color:var(--accent-text)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="block text-lg font-black uppercase leading-tight">
                  {card.title}
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-[color:var(--text-secondary)]">
                  {card.description}
                </span>
                <span className="mt-4 inline-flex text-sm font-black text-[color:var(--accent-text)]">
                  {card.action}
                </span>
              </button>
            );
          })}
        </section>

        <Button
          variant="outline"
          className="h-11 rounded-full font-bold"
          onClick={() => setLocation("/")}
        >
          Browse first
        </Button>
      </div>
    </main>
  );
}
