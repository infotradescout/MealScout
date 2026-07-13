/**
 * TruckSchedulePanel
 *
 * Elevated schedule presentation for food trucks. Answers the core question:
 * "Where is this truck and when can I find it?"
 *
 * Priority display:
 *   1. Current scheduled stop
 *   2. Today's stop
 *   3. Next stop
 *   4. Upcoming schedule list
 *   5. Closed stops (collapsed)
 *
 * Thin state: renders a tasteful "No schedule posted yet" with a claim CTA.
 */
import type {
  PublicRestaurantProfile,
  PublicTruckScheduleStop,
} from "@shared/publicProfiles";
import {
  getTruckScheduleRows,
  getTruckScheduleEmptyStateLabel,
  getTruckScheduleStatusBadgeLabel,
} from "./truckScheduleTruth";
import { MapPin, Clock3, ExternalLink, CalendarDays } from "lucide-react";

type StopRowProps = {
  label: string;
  stop: PublicTruckScheduleStop;
  isCurrent?: boolean;
};

function StopRow({ label, stop, isCurrent = false }: StopRowProps) {
  const locationName = stop.locationName || stop.addressPublicLabel || null;
  const timeLabel = stop.timeWindowLabel || null;
  const directionsHref =
    stop.directionsUrl ||
    (stop.latitude && stop.longitude
      ? `https://maps.google.com/?q=${stop.latitude},${stop.longitude}`
      : null);

  return (
    <div
      className={`rounded-2xl border p-4 space-y-2 ${
        isCurrent
          ? "border-orange-400/35 bg-orange-500/10"
          : "border-white/10 bg-black/20"
      }`}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.18em] ${
          isCurrent ? "text-orange-200/80" : "text-white/45"
        }`}
      >
        {label}
      </p>

      {locationName ? (
        <p
          className={`text-base font-bold leading-snug ${isCurrent ? "text-white" : "text-white/90"}`}
        >
          {locationName}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/70">
        {timeLabel ? (
          <span className="flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5 flex-none text-orange-200/70" />
            {timeLabel}
          </span>
        ) : null}
        {stop.addressPublicLabel && stop.addressPublicLabel !== locationName ? (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 flex-none text-orange-200/70" />
            {stop.addressPublicLabel}
          </span>
        ) : null}
      </div>

      {stop.notice ? (
        <p className="text-xs text-white/60 italic">{stop.notice}</p>
      ) : null}

      {directionsHref ? (
        <a
          href={directionsHref}
          target="_blank"
          rel="noopener noreferrer"
          data-analytics-action="directions_click"
          data-analytics-target-type="truck_schedule"
          className="inline-flex items-center gap-1 text-xs font-semibold text-orange-300 hover:text-orange-200"
        >
          Get directions <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

export function TruckSchedulePanel({
  profile,
}: {
  profile: PublicRestaurantProfile;
}) {
  if (profile.profileType !== "truck") return null;

  const schedule = profile.truckSchedule;
  const {
    currentStop,
    todayStop,
    nextStop,
    upcomingStops,
    closedStops,
    hasActionableSchedule,
  } = getTruckScheduleRows(schedule);

  const statusBadge = getTruckScheduleStatusBadgeLabel(schedule);

  return (
    <section aria-label="Truck schedule" className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
          Schedule
        </p>
        {statusBadge ? (
          <span className="rounded-full border border-orange-400/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-200">
            {statusBadge}
          </span>
        ) : null}
      </div>

      {hasActionableSchedule ? (
        <div className="space-y-2">
          {currentStop ? (
            <StopRow label="Scheduled here now" stop={currentStop} isCurrent />
          ) : null}
          {!currentStop && todayStop ? (
            <StopRow label="Today's stop" stop={todayStop} />
          ) : null}
          {!currentStop && !todayStop && nextStop ? (
            <StopRow label="Next stop" stop={nextStop} />
          ) : null}

          {upcomingStops.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35 pt-1">
                Upcoming
              </p>
              {upcomingStops.map((stop, i) => (
                <div
                  key={`${stop.stopId || stop.date || "stop"}:${i}`}
                  className="flex items-start gap-3 rounded-xl border border-white/8 bg-black/15 px-3 py-2.5"
                >
                  <CalendarDays className="mt-0.5 h-4 w-4 flex-none text-white/40" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/85 truncate">
                      {stop.locationName ||
                        stop.addressPublicLabel ||
                        "Scheduled stop"}
                    </p>
                    <p className="text-xs text-white/50">
                      {[stop.date, stop.timeWindowLabel]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {schedule?.notice ? (
            <p className="rounded-xl border border-white/10 bg-black/15 px-3 py-2.5 text-xs text-white/70">
              {schedule.notice}
            </p>
          ) : null}
        </div>
      ) : (
        /* Thin state — no schedule posted */
        <div className="rounded-2xl border border-white/8 bg-black/15 px-4 py-5 text-center space-y-2">
          <p className="text-sm text-white/55">
            {getTruckScheduleEmptyStateLabel()}
          </p>
          <a
            href="/claim-business"
            className="inline-block text-xs font-semibold text-orange-300 hover:text-orange-200"
          >
            Own this truck? Add your schedule →
          </a>
        </div>
      )}
    </section>
  );
}
