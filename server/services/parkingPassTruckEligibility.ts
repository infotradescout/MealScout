import { resolveStoredFoodBusinessType } from "@shared/businessTypes";
import { isStaffOrAdminUserType } from "@shared/profileAccessPolicy";

export type ParkingPassTruckEligibility = {
  isTruckProfile: boolean;
  emailVerified: boolean;
  storedInsuranceValid: boolean;
  shouldBypassVerificationGate: boolean;
  roleAllowed: boolean;
};

export function assessParkingPassTruckEligibility(input: {
  user: {
    userType?: unknown;
    emailVerified?: unknown;
  } | null | undefined;
  truck: {
    businessType?: unknown;
    isFoodTruck?: unknown;
    insuranceVerified?: unknown;
    insuranceExpiresAt?: unknown;
  };
  now?: Date;
}): ParkingPassTruckEligibility {
  const now = input.now || new Date();
  const expirationValue = input.truck.insuranceExpiresAt;
  const expirationTime = expirationValue
    ? new Date(String(expirationValue)).getTime()
    : null;
  const storedInsuranceValid =
    input.truck.insuranceVerified === true &&
    (expirationTime === null ||
      (Number.isFinite(expirationTime) && expirationTime > now.getTime()));
  const userType =
    typeof input.user?.userType === "string" ? input.user.userType : "";

  return {
    isTruckProfile:
      resolveStoredFoodBusinessType(input.truck) === "food_truck",
    emailVerified: input.user?.emailVerified === true,
    storedInsuranceValid,
    shouldBypassVerificationGate: isStaffOrAdminUserType(userType),
    // Both booking callers separately require exact manageParkingPass access.
    // That explicit business permission also authorizes a verified collaborator;
    // the account's broad legacy userType must not negate it.
    roleAllowed: Boolean(input.user),
  };
}
