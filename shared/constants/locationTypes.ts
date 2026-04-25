/**
 * Centralized location type options for host locations.
 * Used across host-signup, admin dashboard, host dashboard, and map display.
 * 
 * Categories are grouped for easier selection in dropdown UIs.
 */

export type LocationTypeOption = {
  value: string;
  label: string;
  group: string;
};

export const LOCATION_TYPE_OPTIONS: LocationTypeOption[] = [
  // Food & Drink
  { value: "bar", label: "Bar", group: "Food & Drink" },
  { value: "brewery", label: "Brewery", group: "Food & Drink" },
  { value: "winery", label: "Winery", group: "Food & Drink" },
  { value: "distillery", label: "Distillery", group: "Food & Drink" },
  { value: "coffee_shop", label: "Coffee Shop", group: "Food & Drink" },
  { value: "taproom", label: "Taproom", group: "Food & Drink" },

  // Commercial
  { value: "office", label: "Office / Corporate", group: "Commercial" },
  { value: "retail_store", label: "Retail Store", group: "Commercial" },
  { value: "shopping_center", label: "Shopping Center / Strip Mall", group: "Commercial" },
  { value: "gas_station", label: "Gas Station / Convenience Store", group: "Commercial" },
  { value: "auto_dealership", label: "Auto Dealership", group: "Commercial" },
  { value: "warehouse", label: "Warehouse / Industrial", group: "Commercial" },

  // Community & Public
  { value: "church", label: "Church / Place of Worship", group: "Community" },
  { value: "community_center", label: "Community Center", group: "Community" },
  { value: "library", label: "Library", group: "Community" },
  { value: "public_park", label: "Public Park", group: "Community" },
  { value: "farmers_market", label: "Farmers Market", group: "Community" },

  // Education
  { value: "campus", label: "College / University Campus", group: "Education" },
  { value: "school", label: "School (K-12)", group: "Education" },

  // Entertainment & Events
  { value: "event_space", label: "Event Space / Venue", group: "Entertainment" },
  { value: "sports_venue", label: "Sports Venue / Stadium", group: "Entertainment" },
  { value: "fairgrounds", label: "Fairgrounds", group: "Entertainment" },
  { value: "concert_venue", label: "Concert Venue", group: "Entertainment" },
  { value: "movie_theater", label: "Movie Theater", group: "Entertainment" },

  // Outdoor & Recreation
  { value: "campground", label: "Campground / RV Park", group: "Outdoor" },
  { value: "marina", label: "Marina / Boat Dock", group: "Outdoor" },
  { value: "trailhead", label: "Trailhead / Recreation Area", group: "Outdoor" },
  { value: "beach", label: "Beach / Waterfront", group: "Outdoor" },
  { value: "golf_course", label: "Golf Course", group: "Outdoor" },

  // Residential
  { value: "private_residence", label: "Private Residence", group: "Residential" },
  { value: "apartment_complex", label: "Apartment Complex / HOA", group: "Residential" },
  { value: "mobile_home_park", label: "Mobile Home / RV Park", group: "Residential" },

  // Transportation & Parking
  { value: "parking_lot", label: "Parking Lot", group: "Transportation" },
  { value: "truck_stop", label: "Truck Stop", group: "Transportation" },

  // Health & Fitness
  { value: "gym", label: "Gym / Fitness Center", group: "Health" },
  { value: "hospital", label: "Hospital / Medical Center", group: "Health" },

  // Other
  { value: "construction_site", label: "Construction Site", group: "Other" },
  { value: "military_base", label: "Military Base", group: "Other" },
  { value: "other", label: "Other", group: "Other" },
];

/**
 * Get a human-readable label for a location type value.
 * Falls back to title-casing the value if not found.
 */
export function getLocationTypeLabel(value: string): string {
  const option = LOCATION_TYPE_OPTIONS.find((opt) => opt.value === value);
  if (option) return option.label;
  // Fallback: title-case the value
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get grouped options for rendering in an optgroup-style dropdown.
 */
export function getGroupedLocationTypes(): Record<string, LocationTypeOption[]> {
  const groups: Record<string, LocationTypeOption[]> = {};
  for (const opt of LOCATION_TYPE_OPTIONS) {
    if (!groups[opt.group]) groups[opt.group] = [];
    groups[opt.group].push(opt);
  }
  return groups;
}
