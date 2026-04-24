// Shared location utility functions

export async function getReverseGeocodedLocationName(
  latitude: number,
  longitude: number,
  onLocationNameUpdate: (name: string) => void,
): Promise<void> {
  try {
    const response = await fetch(
      `/api/location/reverse?lat=${encodeURIComponent(String(latitude))}&lng=${encodeURIComponent(String(longitude))}`,
    );

    if (response.ok) {
      const data = await response.json();
      const locationName = String(data?.label || "").trim();
      if (locationName && locationName !== "Location") {
        onLocationNameUpdate(locationName);
        return;
      }
    }
  } catch (error) {
    console.warn("Reverse geocoding failed:", error);
  }

  onLocationNameUpdate("Location");
}
