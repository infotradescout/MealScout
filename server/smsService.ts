import { TransactionalSMSApi, TransactionalSMSApiApiKeys } from "@getbrevo/brevo";

const smsApi = new TransactionalSMSApi();

export const isSmsConfigured = (): boolean => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return false;
  }
  try {
    smsApi.setApiKey(TransactionalSMSApiApiKeys.apiKey, apiKey);
    return true;
  } catch (error) {
    console.error("Brevo SMS configuration failed:", error);
    return false;
  }
};

// Brevo requires the destination country code on the recipient number; MealScout's
// signup forms collect a bare 10-digit US number, so backfill the "1" prefix here.
const toInternationalRecipient = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `1${digits}` : digits;
};

export const sendSms = async (to: string, content: string): Promise<boolean> => {
  if (!isSmsConfigured()) {
    return false;
  }

  // Brevo requires a registered toll-free/10DLC sender for US recipients
  // (alphanumeric sender IDs like the "MealScout" fallback are not deliverable there)
  // plus an organisation prefix once compliance is enabled on the account.
  const sender = process.env.BREVO_SMS_SENDER || "MealScout";
  const organisationPrefix = process.env.BREVO_SMS_ORGANISATION_PREFIX;

  try {
    await smsApi.sendTransacSms({
      sender,
      recipient: toInternationalRecipient(to),
      content,
      type: "transactional",
      ...(organisationPrefix ? { organisationPrefix } : {}),
    } as any);
    return true;
  } catch (error) {
    console.error("Brevo SMS send failed:", error);
    return false;
  }
};
