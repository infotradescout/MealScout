export type CountyMapVisibility =
  | { level: "ecosystem" | "source-product"; productIds?: never }
  | { level: "restricted"; productIds: string[] };

export interface CountyMapEvent {
  eventId: string;
  eventType: string;
  sourceRecordId: string;
  subject: { type: string; id: string };
  actor: { type: "system" | "user" | "admin"; id: string };
  occurredAt: string;
  visibility: CountyMapVisibility;
  data: Record<string, unknown>;
  evidenceRefs: string[];
  correctsEventId?: string;
}

export interface CountyMapEventInput extends Omit<CountyMapEvent, "visibility"> {
  countyFips: string;
  visibility?: CountyMapVisibility;
}

export interface CountyMapEventPacket {
  countyFips: string;
  event: CountyMapEvent;
}

export interface CountyMapReadInput {
  countyFips: string;
  limit?: number;
  afterSequence?: number;
  sourceProduct?: string;
  eventType?: string;
  subjectType?: string;
  subjectId?: string;
}

export interface CountyMapDirectoryReadInput {
  limit?: number;
  offset?: number;
  countyFips?: string;
  state?: string;
  county?: string;
  city?: string;
  entityType?: string;
  recordId?: string;
  sourceSystem?: string;
}

export interface CountyMapClient {
  readonly productId: "mealscout";
  readCountyEvents(input: CountyMapReadInput): Promise<Record<string, unknown>>;
  readCountyRecords(input: CountyMapReadInput): Promise<Record<string, unknown>>;
  readDirectoryRecords(input: CountyMapDirectoryReadInput): Promise<Record<string, unknown>>;
  writeCountyEvent(packet: CountyMapEventPacket): Promise<Record<string, unknown>>;
  readContract(): Promise<Record<string, unknown>>;
  readHealth(): Promise<Record<string, unknown>>;
}

export const countyMapAdoption: Readonly<{
  canRead: boolean;
  canWrite: boolean;
  canonicalId: string;
  displayName: string;
  eventNamespaces: string[];
  productId: "mealscout";
  protocolVersion: string;
  readPurpose: string;
  sample: { data: Record<string, unknown>; eventType: string; subjectType: string };
  schemaVersion: string;
  sensitivityRule: string;
  writePurpose: string;
}>;

export class CountyMapClientError extends Error {
  status: number | null;
  code: string;
  retryable: boolean;
  constructor(message: string, details?: { status?: number | null; code?: string; retryable?: boolean });
}

export function buildCountyMapEvent(input: CountyMapEventInput): CountyMapEventPacket;
export function createCountyMapClient(options: {
  baseUrl: string;
  productSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Readonly<CountyMapClient>;
