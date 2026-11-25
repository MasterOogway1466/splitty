import { z } from "zod";

/** A calendar date, not an instant: it means the same day everywhere. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((v) => {
    const date = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
  }, "Not a real date")
  .refine((v) => v >= "1900-01-01" && v <= "2999-12-31", "Date out of range");
