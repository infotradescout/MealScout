/**
 * WhyGoNowPanel
 *
 * A food-decision-first panel that surfaces the most compelling, time-sensitive
 * reasons to visit a business right now. Driven entirely by real data signals —
 * no invented ratings, fake popularity, or synthetic urgency.
 *
 * Signal priority order:
 *   1. Live / here-now truck status
 *   2. Active deals or happy hours
 *   3. Upcoming events or pop-ups
 *   4. Open now with hours
 *   5. Community recommendations
 *   6. Scheduled stop today (trucks)
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { hasTruckScheduleSignal, getTruckSchedulePrimaryStop } from "./truckScheduleTruth";
import { Flame, Clock3, Tag, CalendarDays, Users, MapPin } from "lucide-react";

type Signal = {
  icon: typeof Flame;
  label: string;
  sub: string | null;
  accent: "orange" | "emerald" | "sky" | "amber" | "rose";
};

function buildSignals(profile: PublicRestaurantProfile): Signal[] {
  const signals: Signal[] = [];

  // 1. Live truck status
  if (profile.profileType === "truck" && hasTruckScheduleSignal(profile.truckSchedule)) {
    const primary = getTruckSchedulePrimaryStop(profile.truckSchedule);
    if (primary.kind === "current") {
      signals.push({
        icon: Flame,
        label: "Here right now",
        sub: primary.stop?.locationName || primary.stop?.addressPublicLabel || null,
        accent: "orange",
      });
    } else if (primary.kind === "today") {
      signals.push({
        icon: MapPin,
        label: "Serving today",
        sub: [primary.stop?.locationName, primary.stop?.timeWindowLabel]
          .filter(Boolean)
          .join(" · ") || null,
        accent: "orange",
      });
    }
  }

  // 2. Active deals
  if (profile.deals?.totalActive > 0) {
    const first = profile.deals.items?.[0];
    signals.push({
      icon: Tag,
      label: first?.title || "Deal available",
      sub: first?.timeWindowLabel || first?.description || null,
      accent: "emerald",
    });
  }

  // 3. Open status (restaurants)
  if (profile.profileType !== "truck" && profile.openStatus) {
    const isOpen = /open/i.test(String(profile.openStatus));
    if (isOpen) {
      signals.push({
        icon: Clock3,
        label: profile.openStatus,
        sub: profile.operatingHoursSummary || null,
        accent: "emerald",
      });
    }
  }

  // 4. Upcoming events
  if ((profile.events?.totalUpcoming ?? 0) > 0) {
    const first = profile.events?.items?.[0];
    signals.push({
      icon: CalendarDays,
      label: first?.title || "Event coming up",
      sub: first?.timeWindowLabel || first?.dateLabel || null,
      accent: "sky",
    });
  }

  // 5. Community recommendations
  if ((profile.recommendations?.total ?? 0) > 0) {
    const count = profile.recommendations.total;
    signals.push({
      icon: Users,
      label: count === 1 ? "1 community pick" : `${count} community picks`,
      sub: null,
      accent: "amber",
    });
  }

  return signals.slice(0, 3);
}

const accentClasses: Record<Signal["accent"], { border: string; bg: string; icon: string; text: string }> = {
  orange: {
    border: "border-orange-400/30",
    bg: "bg-orange-500/10",
    icon: "text-orange-300",
    text: "text-orange-100",
  },
  emerald: {
    border: "border-emerald-400/30",
    bg: "bg-emerald-500/10",
    icon: "text-emerald-300",
    text: "text-emerald-100",
  },
  sky: {
    border: "border-sky-400/30",
    bg: "bg-sky-500/10",
    icon: "text-sky-300",
    text: "text-sky-100",
  },
  amber: {
    border: "border-amber-400/30",
    bg: "bg-amber-500/10",
    icon: "text-amber-300",
    text: "text-amber-100",
  },
  rose: {
    border: "border-rose-400/30",
    bg: "bg-rose-500/10",
    icon: "text-rose-300",
    text: "text-rose-100",
  },
};

export function WhyGoNowPanel({ profile }: { profile: PublicRestaurantProfile }) {
  const signals = buildSignals(profile);
  if (signals.length === 0) return null;

  return (
    <section
      aria-label="Why go now"
      className="rounded-2xl border border-white/10 bg-[#0f0d0b] overflow-hidden"
    >
      <div className="px-4 pt-4 pb-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
          Why go now
        </p>
      </div>
      <div className="flex flex-col divide-y divide-white/6">
        {signals.map((signal, i) => {
          const Icon = signal.icon;
          const cls = accentClasses[signal.accent];
          return (
            <div
              key={i}
              className={`flex items-start gap-3 px-4 py-3 ${i === 0 ? cls.bg : ""}`}
            >
              <div
                className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-xl border ${cls.border} ${cls.bg}`}
              >
                <Icon className={`h-4 w-4 ${cls.icon}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-semibold leading-snug ${i === 0 ? cls.text : "text-white/90"}`}>
                  {signal.label}
                </p>
                {signal.sub ? (
                  <p className="mt-0.5 truncate text-xs text-white/55">{signal.sub}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
