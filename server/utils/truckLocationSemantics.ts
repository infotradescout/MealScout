import { isTruckBusinessType } from "@shared/businessTypes";

export type TruckAddressKind =
  | "business_admin"
  | "operating_location"
  | "service_area";

export type TruckOperatingLocationSource =
  | "active_schedule_stop"
  | "upcoming_scheduled_stop"
  | "owner_confirmed_operating_location"
  | "event_booking_location"
  | "verified_live_location_update";

export const CUSTOMER_FACING_TRUCK_LOCATION_SOURCES: TruckOperatingLocationSource[] = [
  "active_schedule_stop",
  "upcoming_scheduled_stop",
  "owner_confirmed_operating_location",
  "event_booking_location",
  "verified_live_location_update",
];

export const THREE_D_EATS_STATIC_ADMIN_ADDRESS =
  "6881 US 98 E, Pensacola, FL 32506";

const normalizeText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeAddress = (value: unknown) => normalizeText(value);

export function isThreeDEatsStaticAdminAddress(params: {
  name?: unknown;
  address?: unknown;
}) {
  const name = normalizeText(params.name);
  const address = normalizeAddress(params.address);
  return (
    [
      "3d eats",
      "3 d eats",
      "3d eats tea",
      "3 d eats tea",
      "3d eats and tea",
      "3 d eats and tea",
    ].includes(name) &&
    address === normalizeAddress(THREE_D_EATS_STATIC_ADMIN_ADDRESS)
  );
}

export function isFoodTruckProfile(row: any) {
  return Boolean(
    row?.isFoodTruck === true || isTruckBusinessType(row?.businessType),
  );
}

export function getTruckLocationMetadata(row: any): Record<string, any> {
  const rawData =
    row && typeof row.rawData === "object" && row.rawData
      ? (row.rawData as Record<string, any>)
      : {};
  const profileLocations =
    rawData && typeof rawData.profileLocations === "object" && rawData.profileLocations
      ? (rawData.profileLocations as Record<string, any>)
      : {};
  const evidenceIngest =
    rawData && typeof rawData.evidenceIngest === "object" && rawData.evidenceIngest
      ? (rawData.evidenceIngest as Record<string, any>)
      : {};
  const evidenceProfileLocations =
    evidenceIngest &&
    typeof evidenceIngest.profileLocations === "object" &&
    evidenceIngest.profileLocations
      ? (evidenceIngest.profileLocations as Record<string, any>)
      : {};

  return {
    ...evidenceProfileLocations,
    ...profileLocations,
  };
}

export function hasCustomerFacingTruckLocationSource(row: any) {
  const metadata = getTruckLocationMetadata(row);
  const source = String(
    metadata.customerFacingLocationSource ||
      metadata.operatingLocationSource ||
      "",
  ).trim();
  return CUSTOMER_FACING_TRUCK_LOCATION_SOURCES.includes(
    source as TruckOperatingLocationSource,
  );
}

export function shouldExposeStaticTruckProfileLocation(row: any) {
  if (!isFoodTruckProfile(row)) return true;
  if (hasCustomerFacingTruckLocationSource(row)) return true;

  const metadata = getTruckLocationMetadata(row);
  const addressKind = String(metadata.addressKind || metadata.address_kind || "")
    .trim()
    .toLowerCase();
  if (addressKind === "operating_location") return true;

  return false;
}

export function buildTruckProfileLocationEvidence(input: {
  businessName: string;
  address?: string;
  serviceArea?: string;
  source?: string;
  existingConflicts?: string[];
}) {
  const conflicts = [...(input.existingConflicts || [])];
  const businessAddress = String(input.address || "").trim();
  const serviceArea = String(input.serviceArea || "").trim();
  const static3dEatsAdmin = isThreeDEatsStaticAdminAddress({
    name: input.businessName,
    address: businessAddress,
  });

  if (businessAddress && serviceArea && normalizeAddress(businessAddress) !== normalizeAddress(serviceArea)) {
    conflicts.push("address_service_area_distinct");
  }

  if (static3dEatsAdmin) {
    conflicts.push("3d_eats_static_admin_address_requires_live_confirmation");
  }

  return {
    businessAdminAddress: businessAddress || null,
    operatingLocation: null,
    operatingLocationSource: null,
    customerFacingLocationSource: null,
    serviceArea: serviceArea || null,
    market: serviceArea || null,
    addressKind: "business_admin" as TruckAddressKind,
    addressPublicByDefault: false,
    menuPageAddressCandidateOnly: true,
    requiresOwnerReview: conflicts.length > 0,
    staticAdminAddressCandidate: Boolean(businessAddress),
    static3dEatsAdminAddressCandidate: static3dEatsAdmin,
    source: input.source || "bulk_evidence_ingest",
    conflicts: Array.from(new Set(conflicts)),
  };
}
