import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { deriveProfileEvidenceQuarantineVisibility } from "./profileEvidenceQuarantine";
import { isImportSystemOwnerEmail } from "../seo/publicRestaurantIndexability";

const ORDERING_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const minutesFromOrderingTime = (value: unknown): number | null => {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
};

export type RestaurantPaymentEligibilityInput = {
  acceptsCash: boolean;
  platformStripeConfigured: boolean;
  stripeConnectAccountId?: unknown;
  stripeOnboardingCompleted?: unknown;
  stripeChargesEnabled?: unknown;
  stripePayoutsEnabled?: unknown;
};

export function isRestaurantPayoutReady(
  input: Omit<
    RestaurantPaymentEligibilityInput,
    "acceptsCash" | "platformStripeConfigured"
  >,
) {
  return Boolean(
    String(input.stripeConnectAccountId || "").trim() &&
      input.stripeOnboardingCompleted === true &&
      input.stripeChargesEnabled === true &&
      input.stripePayoutsEnabled === true,
  );
}

export function resolveRestaurantPaymentMethods(
  input: RestaurantPaymentEligibilityInput,
) {
  const payoutReady = isRestaurantPayoutReady(input);
  return {
    card: Boolean(input.platformStripeConfigured && payoutReady),
    cash: input.acceptsCash === true,
    payoutReady,
  };
}

export function isRestaurantProfileOwnerReady(input: {
  ownerId?: unknown;
  ownerEmail?: unknown;
  isVerified?: unknown;
}): boolean {
  const ownerId = String(input.ownerId || "").trim();
  const ownerEmail = String(input.ownerEmail || "").trim();
  return Boolean(
    ownerId &&
      ownerEmail &&
      !isImportSystemOwnerEmail(ownerEmail) &&
      input.isVerified === true,
  );
}

export function isRestaurantOrderingAuthorityReady(input: {
  ownerId?: unknown;
  ownerEmail?: unknown;
  ownerEmailVerified?: unknown;
  ownerIsDisabled?: unknown;
  isVerified?: unknown;
  orderingApprovedAt?: unknown;
  orderingApprovedByUserId?: unknown;
}): boolean {
  return Boolean(
    isRestaurantProfileOwnerReady(input) &&
      input.ownerEmailVerified === true &&
      input.ownerIsDisabled === false &&
      String(input.orderingApprovedAt || "").trim() &&
      String(input.orderingApprovedByUserId || "").trim(),
  );
}

export function isMenuItemCategoryOrderable(input: {
  categoryId?: unknown;
  categoryActive?: unknown;
}): boolean {
  const categoryId = String(input.categoryId || "").trim();
  return !categoryId || input.categoryActive === true;
}

export function isMenuItemInventoryOrderable(input: {
  trackInventory?: unknown;
  inventoryQty?: unknown;
}): boolean {
  if (input.trackInventory !== true) return true;
  const quantity = Number(input.inventoryQty);
  return Number.isInteger(quantity) && quantity > 0;
}

export function isPickupOrderItemAvailableForExistingReservation(input: {
  isAvailable?: unknown;
  trackInventory?: unknown;
  inventoryQty?: unknown;
  inventoryAutoUnavailable?: unknown;
  inventoryReservedQuantity?: unknown;
}): boolean {
  if (
    input.isAvailable === true &&
    isMenuItemInventoryOrderable(input)
  ) {
    return true;
  }
  return Boolean(
    input.trackInventory === true &&
      input.inventoryAutoUnavailable === true &&
      Number(input.inventoryQty) === 0 &&
      Number.isInteger(Number(input.inventoryReservedQuantity)) &&
      Number(input.inventoryReservedQuantity) > 0,
  );
}

export function isTruckStopOrderableForPickup(input: {
  status?: unknown;
  addressPublicLabel?: unknown;
  locationName?: unknown;
  directionsUrl?: unknown;
} | null | undefined): boolean {
  const pickupLabel = String(
    input?.addressPublicLabel || input?.locationName || "",
  ).trim();
  const directionsUrl = String(input?.directionsUrl || "").trim();
  return Boolean(
    input?.status === "here_now" &&
      pickupLabel &&
      /^https:\/\/maps\.google\.com\/\?q=/i.test(directionsUrl),
  );
}

export function resolveFixedRestaurantPickupAddress(input: {
  restaurant: Record<string, unknown> | null | undefined;
  ownerPublicProfileSettings?: unknown;
}): string | null {
  const restaurant = input.restaurant || {};
  const streetAddress = String(restaurant.address || "").trim();
  const city = String(restaurant.city || "").trim();
  const state = String(restaurant.state || "").trim();
  if (!streetAddress || !city || !state) return null;

  const { showAddress } = resolvePublicProfileVisibility(
    input.ownerPublicProfileSettings,
  );
  const { hidePublicTrustFields, isAccepted, isRejected } =
    deriveProfileEvidenceQuarantineVisibility(restaurant);
  if (
    !showAddress ||
    isRejected("contact_address") ||
    (hidePublicTrustFields && !isAccepted("contact_address"))
  ) {
    return null;
  }

  return [streetAddress, city, state].join(", ");
}

export function isRestaurantOpenNow(
  operatingHours: unknown,
  timeZone: string | null,
  now = new Date(),
): boolean | null {
  if (
    !operatingHours ||
    typeof operatingHours !== "object" ||
    Array.isArray(operatingHours) ||
    !timeZone
  ) {
    return null;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return null;
  }
  const weekday = String(
    parts.find((part) => part.type === "weekday")?.value || "",
  )
    .slice(0, 3)
    .toLowerCase();
  const weekdayIndex = ORDERING_DAY_KEYS.indexOf(weekday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (
    weekdayIndex < 0 ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const schedule = operatingHours as Record<string, unknown>;
  const currentWindows = schedule[weekday];
  const previousDay =
    ORDERING_DAY_KEYS[
      (weekdayIndex + ORDERING_DAY_KEYS.length - 1) % ORDERING_DAY_KEYS.length
    ];
  const previousWindows = schedule[previousDay];
  const nowMinutes = hour * 60 + minute;
  const parsedWindows = (value: unknown) =>
    Array.isArray(value)
      ? value
          .map((window: any) => ({
            open: minutesFromOrderingTime(window?.open ?? window?.start),
            close: minutesFromOrderingTime(window?.close ?? window?.end),
          }))
          .filter(
            (window): window is { open: number; close: number } =>
              window.open !== null &&
              window.close !== null &&
              window.open !== window.close,
          )
      : null;

  const today = parsedWindows(currentWindows);
  if (
    today?.some(({ open, close }) =>
      close > open
        ? nowMinutes >= open && nowMinutes < close
        : nowMinutes >= open,
    )
  ) {
    return true;
  }
  const yesterday = parsedWindows(previousWindows);
  if (
    yesterday?.some(
      ({ open, close }) => close < open && nowMinutes < close,
    )
  ) {
    return true;
  }

  // A missing current-day entry remains unknown unless an explicit prior-day
  // overnight window proves the business is open. An empty array is explicit
  // closed truth.
  return today === null ? null : false;
}

export function isRestaurantMenuAvailableNow(
  menu: {
    availableDays?: unknown;
    availableFrom?: unknown;
    availableTo?: unknown;
  },
  timeZone: string | null,
  now = new Date(),
): boolean {
  if (!timeZone) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return false;
  }
  const weekday = String(parts.find((part) => part.type === "weekday")?.value || "")
    .slice(0, 3)
    .toLowerCase();
  const weekdayIndex = ORDERING_DAY_KEYS.indexOf(weekday);
  if (weekdayIndex < 0) return false;
  const availableDays = Array.isArray(menu.availableDays)
    ? menu.availableDays
        .map((value) => String(value || "").slice(0, 3).toLowerCase())
        .filter((value) => ORDERING_DAY_KEYS.includes(value))
    : ORDERING_DAY_KEYS;
  if (availableDays.length === 0) return false;

  const fromValue = String(menu.availableFrom || "").trim();
  const toValue = String(menu.availableTo || "").trim();
  if (!fromValue && !toValue) return availableDays.includes(weekday);
  const open = minutesFromOrderingTime(fromValue);
  const close = minutesFromOrderingTime(toValue);
  if (open === null || close === null || open === close) return false;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const nowMinutes = hour * 60 + minute;
  if (close < open) {
    if (nowMinutes >= open) return availableDays.includes(weekday);
    const previousDay =
      ORDERING_DAY_KEYS[
        (weekdayIndex + ORDERING_DAY_KEYS.length - 1) %
          ORDERING_DAY_KEYS.length
      ];
    return nowMinutes < close && availableDays.includes(previousDay);
  }
  return (
    availableDays.includes(weekday) &&
    nowMinutes >= open &&
    nowMinutes < close
  );
}
