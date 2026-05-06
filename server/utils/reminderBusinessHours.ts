const DEFAULT_TIME_ZONE = "America/Chicago";
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 17;
const DEFAULT_BUSINESS_DAYS = [1, 2, 3, 4, 5];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ReminderBusinessHoursStatus = {
  allowed: boolean;
  enabled: boolean;
  reason: "allowed" | "disabled" | "outside_business_day" | "outside_business_hours";
  timeZone: string;
  localTimeLabel: string;
  startHour: number;
  endHour: number;
  businessDays: number[];
};

function booleanEnvEnabled(name: string, fallback: boolean): boolean {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "off", "disabled", "no"].includes(value);
}

export function getReminderEmailTimeZone(): string {
  const timeZone = (
    process.env.REMINDER_EMAIL_TIMEZONE ||
    process.env.EMAIL_REMINDER_TIMEZONE ||
    DEFAULT_TIME_ZONE
  );
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    console.warn(
      `[reminder-hours] Invalid reminder email timezone "${timeZone}", falling back to ${DEFAULT_TIME_ZONE}`,
    );
    return DEFAULT_TIME_ZONE;
  }
}

function parseHour(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(24, Math.floor(parsed)));
}

function getReminderWindow() {
  const startHour = parseHour(
    process.env.REMINDER_EMAIL_BUSINESS_HOURS_START,
    DEFAULT_START_HOUR,
  );
  const endHour = parseHour(
    process.env.REMINDER_EMAIL_BUSINESS_HOURS_END,
    DEFAULT_END_HOUR,
  );
  if (endHour <= startHour) {
    return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
  }
  return { startHour, endHour };
}

function getBusinessDays(): number[] {
  const raw = String(process.env.REMINDER_EMAIL_BUSINESS_DAYS || "").trim();
  if (!raw) return DEFAULT_BUSINESS_DAYS;

  const days = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  return days.length > 0 ? Array.from(new Set(days)).sort() : DEFAULT_BUSINESS_DAYS;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    weekday: WEEKDAY_INDEX[parts.weekday || ""] ?? -1,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    label: formatter.format(date),
  };
}

function safeZonedParts(date: Date, timeZone: string) {
  try {
    return { timeZone, ...getZonedParts(date, timeZone) };
  } catch {
    return { timeZone: DEFAULT_TIME_ZONE, ...getZonedParts(date, DEFAULT_TIME_ZONE) };
  }
}

export function getReminderBusinessHoursStatus(
  date = new Date(),
): ReminderBusinessHoursStatus {
  const enabled = booleanEnvEnabled("REMINDER_EMAIL_BUSINESS_HOURS_ENABLED", true);
  const { startHour, endHour } = getReminderWindow();
  const businessDays = getBusinessDays();
  const zoned = safeZonedParts(date, getReminderEmailTimeZone());

  if (!enabled) {
    return {
      allowed: true,
      enabled,
      reason: "disabled",
      timeZone: zoned.timeZone,
      localTimeLabel: zoned.label,
      startHour,
      endHour,
      businessDays,
    };
  }

  if (!businessDays.includes(zoned.weekday)) {
    return {
      allowed: false,
      enabled,
      reason: "outside_business_day",
      timeZone: zoned.timeZone,
      localTimeLabel: zoned.label,
      startHour,
      endHour,
      businessDays,
    };
  }

  if (zoned.hour < startHour || zoned.hour >= endHour) {
    return {
      allowed: false,
      enabled,
      reason: "outside_business_hours",
      timeZone: zoned.timeZone,
      localTimeLabel: zoned.label,
      startHour,
      endHour,
      businessDays,
    };
  }

  return {
    allowed: true,
    enabled,
    reason: "allowed",
    timeZone: zoned.timeZone,
    localTimeLabel: zoned.label,
    startHour,
    endHour,
    businessDays,
  };
}

export function logReminderBusinessHoursSkip(
  context: string,
  status = getReminderBusinessHoursStatus(),
): ReminderBusinessHoursStatus {
  if (!status.allowed) {
    console.warn(
      `[reminder-hours] Skipping ${context}: ${status.reason}; local=${status.localTimeLabel}; allowed=${status.startHour}:00-${status.endHour}:00 ${status.timeZone}; days=${status.businessDays.join(",")}`,
    );
  }
  return status;
}
