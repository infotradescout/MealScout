import { type InsertEvent } from "@shared/schema";
import {
  addDaysToDateKey,
  dateKeyFromUnknown,
  dateKeyInZone,
  utcDateFromDateKey,
  weekdayInZoneForDateKey,
} from "./dateKeys";

// Event series (open calls) helpers.
// Pure domain logic: no Express or storage imports.

const MAX_SERIES_SPAN_DAYS = 180;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function assertMaxSpan180Days(startDate: Date, endDate: Date) {
  const startKey = dateKeyFromUnknown(startDate, "UTC");
  const endKey = dateKeyFromUnknown(endDate, "UTC");
  if (!startKey || !endKey) {
    throw new Error("Invalid event series date range");
  }
  const diffMs =
    utcDateFromDateKey(endKey).getTime() -
    utcDateFromDateKey(startKey).getTime();
  const daysDiff = Math.floor(diffMs / MS_PER_DAY);

  if (daysDiff > MAX_SERIES_SPAN_DAYS) {
    // Message must match existing route behavior exactly
    throw new Error('Event series cannot span more than 180 days');
  }
}

const DAY_MAP: { [key: string]: number } = {
  'SU': 0,
  'MO': 1,
  'TU': 2,
  'WE': 3,
  'TH': 4,
  'FR': 5,
  'SA': 6,
};

export function parseWeeklyRecurrence(recurrenceRule: string | null | undefined): number[] | null {
  if (!recurrenceRule || !recurrenceRule.startsWith('WEEKLY:')) {
    return null;
  }

  const daysStr = recurrenceRule.split(':')[1];
  const selectedDays = daysStr
    .split(',')
    .map(d => DAY_MAP[d])
    .filter((d): d is number => d !== undefined);

  return selectedDays.length > 0 ? selectedDays : null;
}

interface GenerateOccurrencesConfig {
  startDate: Date;
  endDate: Date;
  recurrenceRule?: string | null;
  defaults: {
    hostId: string;
    coordinatorUserId?: string | null;
    seriesId: string;
    name: string;
    description: string | null;
    startTime: string;
    endTime: string;
    maxTrucks: number | undefined;
    hardCapEnabled: boolean | null | undefined;
  };
}

export function generateOccurrences(config: GenerateOccurrencesConfig): InsertEvent[] {
  const { startDate, endDate, recurrenceRule, defaults } = config;

  const startKey = dateKeyFromUnknown(startDate, "UTC");
  const endKey = dateKeyFromUnknown(endDate, "UTC");
  if (!startKey || !endKey || endKey < startKey) {
    throw new Error("Invalid event series date range");
  }

  const occurrences: InsertEvent[] = [];
  const selectedDays = parseWeeklyRecurrence(recurrenceRule ?? null);

  if (selectedDays) {
    let currentKey = startKey;
    while (currentKey <= endKey) {
      if (selectedDays.includes(weekdayInZoneForDateKey(currentKey, "UTC"))) {
        occurrences.push({
          hostId: defaults.hostId,
          coordinatorUserId: defaults.coordinatorUserId ?? null,
          seriesId: defaults.seriesId,
          name: defaults.name,
          description: defaults.description,
          date: utcDateFromDateKey(currentKey),
          startTime: defaults.startTime,
          endTime: defaults.endTime,
          maxTrucks: defaults.maxTrucks,
          hardCapEnabled: defaults.hardCapEnabled,
        });
      }
      currentKey = addDaysToDateKey(currentKey, 1);
    }
  } else {
    // No recurrence: single occurrence on startDate
    occurrences.push({
      hostId: defaults.hostId,
      coordinatorUserId: defaults.coordinatorUserId ?? null,
      seriesId: defaults.seriesId,
      name: defaults.name,
      description: defaults.description,
      date: utcDateFromDateKey(startKey),
      startTime: defaults.startTime,
      endTime: defaults.endTime,
      maxTrucks: defaults.maxTrucks,
      hardCapEnabled: defaults.hardCapEnabled,
    });
  }

  return occurrences;
}

export function filterFutureOccurrences<T extends { date: Date }>(
  occurrences: T[],
  now: Date,
  timeZone: string,
): T[] {
  const todayKey = dateKeyInZone(now, timeZone);
  return occurrences.filter((occurrence) => {
    const occurrenceKey = dateKeyFromUnknown(occurrence.date, "UTC");
    return Boolean(occurrenceKey && occurrenceKey >= todayKey);
  });
}
