// Phase 5 schema modularization: domain barrel over legacy exports
export {
  parkingPassBlackoutDates,
  truckManualSchedules,
  truckParkingReports,
  parkingPassBlackoutDatesRelations,
  truckManualSchedulesRelations,
  truckParkingReportsRelations,
  insertParkingPassBlackoutDateSchema,
  parkingRoutePlans,
} from "./legacy";

export type {
  ParkingPassBlackoutDate,
  InsertParkingPassBlackoutDate,
  TruckManualSchedule,
  TruckParkingReport,
  ParkingRoutePlan,
  InsertParkingRoutePlan,
} from "./legacy";
