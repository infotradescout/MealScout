import webpush from "web-push";

type PushSubscriptionShape = {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

let configured = false;
let configError: string | null = null;

const getVapidConfig = () => {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const contact = String(process.env.VAPID_SUBJECT || "mailto:info@mealscout.us").trim();
  return { publicKey, privateKey, contact };
};

export const getPushConfigSummary = () => {
  const { publicKey, privateKey, contact } = getVapidConfig();
  const missing: string[] = [];
  if (!publicKey) missing.push("VAPID_PUBLIC_KEY");
  if (!privateKey) missing.push("VAPID_PRIVATE_KEY");
  return {
    configured: missing.length === 0,
    missing,
    subject: contact,
    error: configError,
  };
};

export const ensurePushConfigured = () => {
  if (configured) return true;

  const { publicKey, privateKey, contact } = getVapidConfig();
  if (!publicKey || !privateKey) {
    configError = "VAPID keys are not configured.";
    return false;
  }

  try {
    webpush.setVapidDetails(contact, publicKey, privateKey);
    configured = true;
    configError = null;
    return true;
  } catch (error: any) {
    configError = String(error?.message || error || "Unknown web push error");
    configured = false;
    return false;
  }
};

export const getPublicVapidKey = () => String(process.env.VAPID_PUBLIC_KEY || "").trim();

export const sendPushNotification = async (
  subscription: PushSubscriptionShape,
  payload: Record<string, unknown>,
) => {
  if (!ensurePushConfigured()) {
    return { ok: false, statusCode: 503, error: "Push provider not configured" };
  }

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return { ok: false, statusCode: 400, error: "Invalid push subscription" };
  }

  try {
    await webpush.sendNotification(
      subscription as any,
      JSON.stringify(payload || {}),
      {
        TTL: 60,
        urgency: "normal",
      },
    );
    return { ok: true as const };
  } catch (error: any) {
    const statusCode = Number(error?.statusCode || 500);
    const errorText =
      String(error?.body || error?.message || "Push send failed").slice(0, 500);
    return { ok: false as const, statusCode, error: errorText };
  }
};
