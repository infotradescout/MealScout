import {
  classifyServiceInterval,
  type ServiceIntervalPhase,
} from "./timeIntent";

export type ParkingPassBookingTimePolicy =
  | "must_start_in_future"
  | "until_service_end";

export function evaluateParkingPassBookingTime(input: {
  timeZone: string;
  date: Date | string;
  startTime: string;
  endTime: string;
  now?: Date;
  policy: ParkingPassBookingTimePolicy;
}): {
  eligible: boolean;
  phase: ServiceIntervalPhase;
  reason: "available" | "invalid_interval" | "past_date" | "slot_started" | "service_ended";
} {
  const interval = classifyServiceInterval(input);
  if (interval.phase === "invalid") {
    return { eligible: false, phase: interval.phase, reason: "invalid_interval" };
  }
  if (
    interval.dateKey &&
    interval.localTodayKey &&
    interval.dateKey < interval.localTodayKey &&
    (input.policy === "must_start_in_future" || interval.phase !== "in_service")
  ) {
    return { eligible: false, phase: interval.phase, reason: "past_date" };
  }
  if (interval.phase === "ended") {
    return { eligible: false, phase: interval.phase, reason: "service_ended" };
  }
  if (
    input.policy === "must_start_in_future" &&
    interval.phase === "in_service"
  ) {
    return { eligible: false, phase: interval.phase, reason: "slot_started" };
  }
  return { eligible: true, phase: interval.phase, reason: "available" };
}
