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

export function RestaurantHoursPanel({
  profile,
}: {
  profile: PublicRestaurantProfile;
}) {
  if (profile.profileType === "truck") return null;

  const { isOpen, label: statusLabel } = parseOpenStatus(profile.openStatus);
  const hours = String(profile.operatingHoursSummary || "").trim();
  const hasAnyHoursData = Boolean(statusLabel || hours);

  return (
    <section aria-label="Hours" className="space-y-3">
      <p className="profile-section-label">
        Hours
      </p>

      {hasAnyHoursData ? (
        <div className="profile-surface overflow-hidden rounded-2xl">
          {statusLabel ? (
            <div
              className={`flex items-center gap-2 border-b border-[color:var(--profile-border)] px-4 py-3 ${
                isOpen === true
                  ? "bg-emerald-50"
                  : isOpen === false
                    ? "bg-stone-50"
                    : "bg-[color:var(--profile-surface-soft)]"
              }`}
            >
              <span
                className={`h-2 w-2 flex-none rounded-full ${
                  isOpen === true
                    ? "bg-emerald-500"
                    : isOpen === false
                      ? "bg-stone-400"
                      : "bg-amber-500"
                }`}
              />
              <p
                className={`text-sm font-semibold ${
                  isOpen === true
                    ? "text-emerald-800"
                    : isOpen === false
                      ? "text-stone-600"
                      : "text-amber-800"
                }`}
              >
                {statusLabel}
              </p>
            </div>
          ) : null}

          {hours ? (
            <div className="flex items-start gap-3 px-4 py-3">
              <Clock3 className="mt-0.5 h-4 w-4 flex-none text-[color:var(--profile-accent)]" />
              <p className="whitespace-pre-line text-sm leading-relaxed text-[color:var(--profile-ink-soft)]">
                {hours}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        /* Thin state */
        <div className="rounded-2xl border border-[color:var(--profile-border)] bg-[color:var(--profile-surface-soft)] px-4 py-5 text-center space-y-2">
          <p className="text-sm text-[color:var(--profile-muted)]">Hours not posted yet.</p>
          <a
            href="/claim-business"
            className="inline-block text-xs font-semibold text-[#b93619] hover:text-[#8f2a14]"
          >
            Own this place? Add your hours →
          </a>
        </div>
      )}
    </section>
  );
}
