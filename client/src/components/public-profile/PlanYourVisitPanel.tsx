/**
 * PlanYourVisitPanel
 *
 * Aggregates everything a visitor needs to actually show up:
 * - Address / location
 * - Directions link
 * - Phone number
 * - Website
 * - Social links (Instagram, Facebook, X)
 *
 * Renders nothing if there is no actionable contact or location data.
 * Does not render for trucks (they use TruckSchedulePanel for location context).
 */
import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { MapPin, Phone, Globe, ExternalLink } from "lucide-react";

type PlanYourVisitPanelProps = {
  profile: PublicRestaurantProfile;
};

export function PlanYourVisitPanel({ profile }: PlanYourVisitPanelProps) {
  const address = String(profile.addressPublicLabel || "").trim();
  const phone = String(profile.phonePublic || "").trim();
  const website = String(profile.websiteUrl || "").trim();
  const instagram = String(profile.socialLinks?.instagramUrl || "").trim();
  const facebook = String(profile.socialLinks?.facebookPageUrl || "").trim();
  const xUrl = String(profile.socialLinks?.xUrl || "").trim();

  const hasCoords =
    typeof profile.latitude === "number" && typeof profile.longitude === "number";
  const directionsHref = hasCoords
    ? `https://maps.google.com/?q=${profile.latitude},${profile.longitude}`
    : address
      ? `https://maps.google.com/?q=${encodeURIComponent(address)}`
      : null;

  const hasAnyData = Boolean(address || phone || website || directionsHref);
  if (!hasAnyData) return null;

  const rows: Array<{
    icon: typeof MapPin;
    label: string;
    href: string | null;
    external?: boolean;
  }> = [];

  if (address) {
    rows.push({
      icon: MapPin,
      label: address,
      href: directionsHref,
      external: true,
    });
  }

  if (phone) {
    rows.push({
      icon: Phone,
      label: phone,
      href: `tel:${phone.replace(/\D/g, "")}`,
    });
  }

  if (website) {
    let displayUrl = website;
    try {
      displayUrl = new URL(website).hostname.replace(/^www\./, "");
    } catch {
      /* keep raw */
    }
    rows.push({
      icon: Globe,
      label: displayUrl,
      href: website,
      external: true,
    });
  }

  const socialLinks = [
    { label: "Instagram", href: instagram },
    { label: "Facebook", href: facebook },
    { label: "X / Twitter", href: xUrl },
  ].filter((s) => s.href);

  return (
    <section aria-label="Plan your visit" className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
        Plan your visit
      </p>

      <div className="rounded-2xl border border-white/10 bg-[#0f0d0b] divide-y divide-white/6 overflow-hidden">
        {rows.map((row, i) => {
          const Icon = row.icon;
          const inner = (
            <div className="flex items-start gap-3 px-4 py-3">
              <Icon className="mt-0.5 h-4 w-4 flex-none text-orange-200/60" />
              <p className="text-sm text-white/80 leading-snug min-w-0 break-words">
                {row.label}
              </p>
              {row.href && row.external ? (
                <ExternalLink className="ml-auto mt-0.5 h-3.5 w-3.5 flex-none text-white/30" />
              ) : null}
            </div>
          );

          return row.href ? (
            <a
              key={i}
              href={row.href}
              target={row.external ? "_blank" : undefined}
              rel={row.external ? "noopener noreferrer" : undefined}
              data-analytics-action={row.icon === MapPin ? "directions_click" : "contact_click"}
              data-analytics-target-type={row.icon === MapPin ? "map" : "contact"}
              className="block hover:bg-white/5 transition-colors"
            >
              {inner}
            </a>
          ) : (
            <div key={i}>{inner}</div>
          );
        })}

        {socialLinks.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {socialLinks.map((s) => (
              <a
                key={s.href}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                data-analytics-action="social_click"
                data-analytics-target-type="social"
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white/75 hover:bg-white/10 hover:text-white"
              >
                {s.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
