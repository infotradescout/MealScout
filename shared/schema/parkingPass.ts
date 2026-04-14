// Phase 5 schema modularization: domain barrel over legacy exports
export {
  parkingPassBlackoutDates,
  truckManualSchedules,
  truckParkingReports,
  parkingPassBlackoutDatesRelations,
  truckManualSchedulesRelations,
  truckParkingReportsRelations,
  insertParkingPassBlackoutDateSchema,
} from "./legacy";

export type {
  ParkingPassBlackoutDate,
  InsertParkingPassBlackoutDate,
  TruckManualSchedule,
  TruckParkingReport,
} from "./legacy";
