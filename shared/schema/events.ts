// Phase 5 schema modularization: domain barrel over legacy exports
export {
  events,
  eventInterests,
  eventBookings,
  eventInterestsRelations,
  eventsRelations,
  eventBookingsRelations,
  insertEventSchema,
  insertEventInterestSchema,
  insertEventBookingSchema,
  telemetryEvents,
} from "./legacy";

export type {
  Event,
  InsertEvent,
  EventInterest,
  InsertEventInterest,
  EventBooking,
  InsertEventBooking,
  TelemetryEvent,
  InsertTelemetryEvent,
} from "./legacy";
