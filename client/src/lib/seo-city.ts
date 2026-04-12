export const normalizeSeoTerm = (value?: string | null) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ");

export const slugifySeoTerm = (value?: string | null) =>
  normalizeSeoTerm(value).replace(/\s+/g, "-");

export const deslugSeoTerm = (value?: string) =>
  normalizeSeoTerm(String(value || "").replace(/-/g, " "));

export const titleCaseSeoTerm = (value?: string | null) =>
  normalizeSeoTerm(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const buildFoodTrucksCityPath = (
  citySlug?: string | null,
  cuisineSlug?: string | null,
) => {
  const city = String(citySlug || "").trim().toLowerCase();
  if (!city) return "/food-trucks";
  const cuisine = String(cuisineSlug || "").trim().toLowerCase();
  return cuisine
    ? `/food-trucks/${encodeURIComponent(city)}/${encodeURIComponent(cuisine)}`
    : `/food-trucks/${encodeURIComponent(city)}`;
};

export const buildFoodTrucksCityCanonicalUrl = (
  citySlug?: string | null,
  cuisineSlug?: string | null,
) => `https://www.mealscout.us${buildFoodTrucksCityPath(citySlug, cuisineSlug)}`;

