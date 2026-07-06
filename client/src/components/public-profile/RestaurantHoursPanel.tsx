/**
 * RestaurantHoursPanel
 *
 * Answers the question: "Is this place open right now, and when can I go?"
 * Renders the open/closed status prominently and the hours string cleanly.
 * Thin state: renders a tasteful "Hours not posted" with a claim CTA.
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { Clock3 } from "lucide-react";

function parseOpenStatus(openStatus: string | null): {
  isOpen: boolean | null;
  label: string | null;
} {
  if (!openStatus) return { isOpen: null, label: null };
  const lower = openStatus.toLowerCase();
  if (/open/i.test(lower) && !/closed/i.test(lower)) {
    return { isOpen: true, label: openStatus };
  }
  if (/closed/i.test(lower)) {
    return { isOpen: false, label: openStatus };
  }
  return { isOpen: null, label: openStatus };
}

export function RestaurantHoursPanel({ profile }: { profile: PublicRestaurantProfile }) {
  if (profile.profileType === "truck") return null;

  const { isOpen, label: statusLabel } = parseOpenStatus(profile.openStatus);
  const hours = String(profile.hours || "").trim();
  const hasAnyHoursData = Boolean(statusLabel || hours);

  return (
    <section aria-label="Hours" className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
        Hours
      </p>

      {hasAnyHoursData ? (
        <div className="rounded-2xl border border-white/10 bg-[#0f0d0b] overflow-hidden">
          {statusLabel ? (
            <div
              className={`flex items-center gap-2 px-4 py-3 border-b border-white/8 ${
                isOpen === true
                  ? "bg-emerald-500/10"
                  : isOpen === false
                    ? "bg-white/5"
                    : "bg-black/10"
              }`}
            >
              <span
                className={`h-2 w-2 flex-none rounded-full ${
                  isOpen === true
                    ? "bg-emerald-400"
                    : isOpen === false
                      ? "bg-white/30"
                      : "bg-white/20"
                }`}
              />
              <p
                className={`text-sm font-semibold ${
                  isOpen === true
                    ? "text-emerald-200"
                    : isOpen === false
                      ? "text-white/60"
                      : "text-white/80"
                }`}
              >
                {statusLabel}
              </p>
            </div>
          ) : null}

          {hours ? (
            <div className="flex items-start gap-3 px-4 py-3">
              <Clock3 className="mt-0.5 h-4 w-4 flex-none text-orange-200/60" />
              <p className="text-sm text-white/80 whitespace-pre-line leading-relaxed">
                {hours}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        /* Thin state */
        <div className="rounded-2xl border border-white/8 bg-black/15 px-4 py-5 text-center space-y-2">
          <p className="text-sm text-white/50">Hours not posted yet.</p>
          <a
            href="/claim-business"
            className="inline-block text-xs font-semibold text-orange-300 hover:text-orange-200"
          >
            Own this place? Add your hours →
          </a>
        </div>
      )}
    </section>
  );
}
