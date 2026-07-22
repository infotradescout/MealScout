import { z } from "zod";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseEventDateOnly(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export const eventDateInputSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const date = parseEventDateOnly(value);
    if (!date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Event date must use YYYY-MM-DD and be a valid calendar date",
      });
      return z.NEVER;
    }

    return date;
  });

export function formatEventDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
