type GoogleAutoLinkBusiness = {
  id?: string | null;
  name?: string | null;
  businessName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  googlePlaceId?: string | null;
  googlePhotos?: unknown;
  description?: string | null;
  phone?: string | null;
  contactPhone?: string | null;
  websiteUrl?: string | null;
  businessWebsite?: string | null;
  profileSource?: string | null;
};

const parsePhotoArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const isPlaceholderText = (value: unknown) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return [
    "pending",
    "address pending",
    "test",
    "testville",
    "unknown",
    "n/a",
    "na",
  ].includes(normalized);
};

const hasUsefulLocation = (row: GoogleAutoLinkBusiness) => {
  const address = String(row.address || "").trim();
  const city = String(row.city || "").trim();
  const state = String(row.state || "").trim();
  if (isPlaceholderText(address) && isPlaceholderText(city)) return false;
  return Boolean(address || (city && state));
};

const hasGoogleRichData = (row: GoogleAutoLinkBusiness) =>
  Boolean(
    row.googlePlaceId &&
      (parsePhotoArray(row.googlePhotos).length > 0 ||
        row.description ||
        row.phone ||
        row.contactPhone ||
        row.websiteUrl ||
        row.businessWebsite),
  );

export const shouldAttemptGoogleRestaurantAutoLink = (
  row: GoogleAutoLinkBusiness,
) => {
  if (!row?.id || isPlaceholderText(row.name)) return false;
  if (!hasUsefulLocation(row)) return false;
  return !hasGoogleRichData(row);
};

export const shouldAttemptGoogleHostAutoLink = (
  row: GoogleAutoLinkBusiness,
) => {
  if (!row?.id || isPlaceholderText(row.businessName || row.name)) return false;
  if (!hasUsefulLocation(row)) return false;
  return !hasGoogleRichData(row);
};

export const queueGoogleRestaurantAutoLink = (
  row: GoogleAutoLinkBusiness,
  context = "restaurant",
) => {
  if (!shouldAttemptGoogleRestaurantAutoLink(row)) return;
  import("./googleProfileService")
    .then(({ populateRestaurantProfile }) => populateRestaurantProfile(String(row.id)))
    .then((result) => {
      if (!result?.success) {
        console.warn(`[${context}] Google restaurant auto-link skipped`, {
          restaurantId: row.id,
          reason: result?.error || "unknown",
        });
      }
    })
    .catch((error) => {
      console.warn(`[${context}] Google restaurant auto-link failed`, {
        restaurantId: row.id,
        error,
      });
    });
};

export const queueGoogleHostAutoLink = (
  row: GoogleAutoLinkBusiness,
  context = "host",
) => {
  if (!shouldAttemptGoogleHostAutoLink(row)) return;
  import("./googleProfileService")
    .then(({ populateHostProfile }) => populateHostProfile(String(row.id)))
    .then((result) => {
      if (!result?.success) {
        console.warn(`[${context}] Google host auto-link skipped`, {
          hostId: row.id,
          reason: result?.error || "unknown",
        });
      }
    })
    .catch((error) => {
      console.warn(`[${context}] Google host auto-link failed`, {
        hostId: row.id,
        error,
      });
    });
};
