import type {
  PublicTruckScheduleStop,
  PublicTruckScheduleSummary,
} from "@shared/publicProfiles";

const EMPTY_SCHEDULE_LABEL = "No schedule posted";

const hasText = (value: unknown) => String(value || "").trim().length > 0;

const hasRenderableStop = (stop: PublicTruckScheduleStop | null | undefined) =>
  Boolean(
    stop &&
      (hasText(stop.stopId) ||
        hasText(stop.date) ||
        hasText(stop.timeWindowLabel) ||
        hasText(stop.locationName) ||
        hasText(stop.addressPublicLabel)),
  );

const normalizeStops = (stops: PublicTruckScheduleStop[] | null | undefined) =>
  (Array.isArray(stops) ? stops : []).filter(hasRenderableStop);

export const getTruckScheduleRows = (
  schedule: PublicTruckScheduleSummary | null | undefined,
) => {
  const currentStop = hasRenderableStop(schedule?.currentStop) ? schedule!.currentStop : null;
  const todayStop = hasRenderableStop(schedule?.todayStop) ? schedule!.todayStop : null;
  const nextStop = hasRenderableStop(schedule?.nextStop) ? schedule!.nextStop : null;
  const upcomingStops = normalizeStops(schedule?.upcomingStops);
  const closedStops = normalizeStops(schedule?.closedStops);
  const hasActionableSchedule = Boolean(
    currentStop || todayStop || nextStop || upcomingStops.length > 0,
  );

  return {
    currentStop,
    todayStop,
    nextStop,
    upcomingStops,
    closedStops,
    hasActionableSchedule,
  };
};

export const getTruckScheduleEmptyStateLabel = () => EMPTY_SCHEDULE_LABEL;

export const getTruckScheduleAvailabilityLabel = (
  schedule: PublicTruckScheduleSummary | null | undefined,
) =>
  getTruckScheduleRows(schedule).hasActionableSchedule
    ? "Schedule available"
    : EMPTY_SCHEDULE_LABEL;

export const getTruckScheduleStatusBadgeLabel = (
  schedule: PublicTruckScheduleSummary | null | undefined,
) => {
  const statusLabel = String(schedule?.statusLabel || "").trim() || null;
  if (!getTruckScheduleRows(schedule).hasActionableSchedule) return null;
  if (schedule?.status === "here_now") return "Scheduled here now";
  return statusLabel;
};

export const hasTruckScheduleCta = (
  schedule: PublicTruckScheduleSummary | null | undefined,
) => getTruckScheduleRows(schedule).hasActionableSchedule;

export const hasTruckScheduleSignal = (
  schedule: PublicTruckScheduleSummary | null | undefined,
) => getTruckScheduleRows(schedule).hasActionableSchedule;

export const getTruckSchedulePrimaryStop = (
  schedule: PublicTruckScheduleSummary | null | undefined,
) => {
  const rows = getTruckScheduleRows(schedule);
  if (rows.currentStop) {
    return {
      kind: "current" as const,
      label: "Scheduled here now",
      stop: rows.currentStop,
    };
  }
  if (rows.todayStop) {
    return { kind: "today" as const, label: "Today", stop: rows.todayStop };
  }
  if (rows.nextStop) {
    return { kind: "next" as const, label: "Next stop", stop: rows.nextStop };
  }
  if (rows.upcomingStops[0]) {
    return { kind: "upcoming" as const, label: "Upcoming schedule", stop: rows.upcomingStops[0] };
  }
  return { kind: "empty" as const, label: EMPTY_SCHEDULE_LABEL, stop: null };
};
