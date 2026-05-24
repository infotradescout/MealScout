import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { toPublicRestaurantProfile } from "./toPublicRestaurantProfile";

export function toPublicTruckProfile(input: {
  row: any;
  baseUrl: string;
  showAddress?: boolean;
  showContact?: boolean;
}): PublicRestaurantProfile {
  return toPublicRestaurantProfile({
    ...input,
    profileType: "truck",
  });
}
