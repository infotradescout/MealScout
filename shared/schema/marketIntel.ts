// Phase 5 schema modularization: domain barrel over legacy exports
export {
  marketCounties,
  marketMetrics,
  marketNotes,
  marketEntities,
} from "./legacy";

export type {
  MarketCounty,
  InsertMarketCounty,
  MarketMetric,
  InsertMarketMetric,
  MarketNote,
  InsertMarketNote,
  MarketEntity,
  InsertMarketEntity,
} from "./legacy";
