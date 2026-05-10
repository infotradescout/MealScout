type NotificationSettings = {
  notifications?: {
    channels?: Record<string, unknown>;
    topics?: Record<string, unknown>;
  };
};

function settingsOf(accountSettings: unknown): NotificationSettings {
  return accountSettings && typeof accountSettings === "object"
    ? (accountSettings as NotificationSettings)
    : {};
}

export function isNotificationChannelEnabled(
  accountSettings: unknown,
  channel: string,
  defaultValue = true,
): boolean {
  const channels = settingsOf(accountSettings).notifications?.channels;
  const value = channels?.[channel];
  return typeof value === "boolean" ? value : defaultValue;
}

export function isNotificationTopicEnabled(
  accountSettings: unknown,
  topic: string,
  defaultValue = true,
): boolean {
  const topics = settingsOf(accountSettings).notifications?.topics;
  const value = topics?.[topic];
  return typeof value === "boolean" ? value : defaultValue;
}

export function canEmailForTopic(
  accountSettings: unknown,
  topic: string,
  defaultValue = true,
): boolean {
  return (
    isNotificationChannelEnabled(accountSettings, "email", defaultValue) &&
    isNotificationTopicEnabled(accountSettings, topic, defaultValue)
  );
}

export function canSmsForTopic(
  accountSettings: unknown,
  topic: string,
  defaultValue = false,
): boolean {
  return (
    isNotificationChannelEnabled(accountSettings, "sms", defaultValue) &&
    isNotificationTopicEnabled(accountSettings, topic, true)
  );
}

export function parseAdminBroadcastMaxRecipients(raw: unknown): number {
  const parsed = Number(raw ?? 250);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(1000, Math.floor(parsed)))
    : 250;
}
