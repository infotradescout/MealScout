export const ACTION_API_PUBLIC_READ_ACTIONS = [
  "FIND_DEALS",
  "FIND_RESTAURANTS",
  "GET_RESTAURANT_DETAILS",
  "GET_FOOD_TRUCKS",
  "GET_PARKING_PASS_SPOTS",
] as const;

export const ACTION_API_USER_SCOPED_ACTIONS = [
  "CREATE_RESTAURANT",
  "UPDATE_RESTAURANT",
  "UPDATE_RESTAURANT_PROFILE",
  "UPDATE_RESTAURANT_LOCATION",
  "UPDATE_RESTAURANT_OPERATING_HOURS",
  "LIST_MENUS",
  "CREATE_MENU",
  "UPDATE_MENU",
  "DELETE_MENU",
  "CREATE_MENU_CATEGORY",
  "UPDATE_MENU_CATEGORY",
  "DELETE_MENU_CATEGORY",
  "CREATE_MENU_ITEM",
  "UPDATE_MENU_ITEM",
  "DELETE_MENU_ITEM",
  "GET_MANUAL_SCHEDULES",
  "UPSERT_MANUAL_SCHEDULE",
  "DELETE_MANUAL_SCHEDULE",
  "BOOK_PARKING_SPOT",
  "REDEEM_CREDITS",
  "GET_CREDITS_BALANCE",
  "SUBMIT_BUILDER_APPLICATION",
] as const;

const publicReadActions = new Set<string>(ACTION_API_PUBLIC_READ_ACTIONS);
const userScopedActions = new Set<string>(ACTION_API_USER_SCOPED_ACTIONS);

/**
 * Static integration tokens do not establish a user principal. Keep their
 * runtime authority limited to public discovery reads until the principal and
 * delegation model is implemented and independently verified.
 */
export function isActionApiPublicRead(action: unknown): boolean {
  return typeof action === "string" && publicReadActions.has(action);
}

export function isKnownActionApiAction(action: unknown): boolean {
  return (
    typeof action === "string" &&
    (publicReadActions.has(action) || userScopedActions.has(action))
  );
}

export const ACTION_API_WRITE_CONTAINMENT_CODE =
  "ACTION_REQUIRES_TRUSTED_PRINCIPAL" as const;
