import { resolveCoordinatePair } from "@shared/consumerEntity";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";

export function resolvePublicHostProximityCoordinates(input: {
  latitude: unknown;
  longitude: unknown;
  publicProfileSettings?: unknown;
  showAddress?: boolean;
}) {
  const showAddress =
    typeof input.showAddress === "boolean"
      ? input.showAddress
      : resolvePublicProfileVisibility(input.publicProfileSettings).showAddress;
  if (!showAddress) return null;
  return resolveCoordinatePair(input.latitude, input.longitude);
}
