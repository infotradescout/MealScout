import type { PublicRestaurantProfile } from "@shared/publicProfiles";
import { toPublicRestaurantProfile } from "./toPublicRestaurantProfile";

export function toPublicBarProfile(input: {
  row: any;
  baseUrl: string;
  showAddress?: boolean;
  showContact?: boolean;
}): PublicRestaurantProfile {
  return toPublicRestaurantProfile({
    ...input,
    profileType: "bar",
  });
}
