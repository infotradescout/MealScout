import { z } from "zod";

/** Multipart forms carry text; JavaScript truthiness would turn "false" into true. */
export const booleanInput = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1"].includes(normalized)) return true;
  if (["false", "0"].includes(normalized)) return false;
  return value;
}, z.boolean());
