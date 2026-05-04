import { ContactsApi, ContactsApiApiKeys } from "@getbrevo/brevo";
import type { User } from "@shared/schema";

const contactsApi = new ContactsApi();

const listEnvMap: Record<string, string> = {
  customer: "BREVO_LIST_CUSTOMER_ID",
  restaurant_owner: "BREVO_LIST_RESTAURANT_OWNER_ID",
  caterer: "BREVO_LIST_RESTAURANT_OWNER_ID",
  private_chef: "BREVO_LIST_RESTAURANT_OWNER_ID",
  food_truck: "BREVO_LIST_FOOD_TRUCK_ID",
  host: "BREVO_LIST_HOST_ID",
  event_coordinator: "BREVO_LIST_EVENT_COORDINATOR_ID",
};

const getListIdForUserType = (userType?: string) => {
  if (!userType) return null;
  const envKey = listEnvMap[userType];
  if (!envKey) return null;
  const raw = process.env[envKey];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const getAllConfiguredListIds = () => {
  return Object.values(listEnvMap)
    .map((envKey) => {
      const raw = process.env[envKey];
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((value): value is number => value !== null);
};

export const isCrmConfigured = (): boolean => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return false;
  }

  try {
    contactsApi.setApiKey(ContactsApiApiKeys.apiKey, apiKey);
    return true;
  } catch (error) {
    console.error("Brevo CRM configuration failed:", error);
    return false;
  }
};

export const syncUserToBrevo = async (user: User): Promise<boolean> => {
  if (!user.email) {
    return false;
  }

  if (!isCrmConfigured()) {
    return false;
  }

  const listId = getListIdForUserType(user.userType);
  if (!listId) {
    return false;
  }

  try {
    const allListIds = getAllConfiguredListIds();
    const otherListIds = allListIds.filter((id) => id !== listId);
    if (otherListIds.length > 0) {
      await Promise.all(
        otherListIds.map((id) =>
          contactsApi.removeContactFromList(id, { emails: [user.email] } as any)
        )
      );
    }

    await contactsApi.createContact({
      email: user.email,
      attributes: {
        FIRSTNAME: user.firstName || undefined,
        LASTNAME: user.lastName || undefined,
        PHONE: user.phone || undefined,
        USER_TYPE: user.userType,
      },
      listIds: [listId],
      updateEnabled: true,
    } as any);
    return true;
  } catch (error) {
    console.error("Brevo CRM sync failed:", error);
    return false;
  }
};
