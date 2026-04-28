const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const ensurePermission = async () => {
  if (!("Notification" in window)) {
    throw new Error("Notifications are not supported in this browser.");
  }

  if (Notification.permission === "granted") {
    return true;
  }

  const permission = await Notification.requestPermission();
  return permission === "granted";
};

const getServiceWorkerRegistration = async () => {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser.");
  }

  const reg = await navigator.serviceWorker.register("/sw-push.js");
  return reg;
};

export const subscribeToPush = async (): Promise<boolean> => {
  const granted = await ensurePermission();
  if (!granted) {
    throw new Error("Notification permission was denied.");
  }

  const keyRes = await fetch("/api/notifications/push/public-key", {
    credentials: "include",
  });
  if (!keyRes.ok) {
    const body = await keyRes.json().catch(() => ({}));
    throw new Error(body?.message || "Push public key is unavailable.");
  }
  const { publicKey } = await keyRes.json();

  const registration = await getServiceWorkerRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const res = await fetch("/api/notifications/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to save push subscription.");
  }

  return true;
};

export const unsubscribeFromPush = async (): Promise<void> => {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  const endpoint = subscription.endpoint;
  try {
    await fetch("/api/notifications/push/unsubscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } finally {
    await subscription.unsubscribe().catch(() => {});
  }
};

export const sendPushTest = async () => {
  const res = await fetch("/api/notifications/push/test", {
    method: "POST",
    credentials: "include",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.message || "Push test failed.");
  }
  return payload;
};
