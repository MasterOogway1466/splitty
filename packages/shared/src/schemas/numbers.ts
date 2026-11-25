import { z } from "zod";

/** Positive, at most two decimals: splits are computed on whole hundredths. */
export const hundredthsSchema = (max: number) =>
  z
    .number()
    .positive()
    .max(max)
    .refine((v) => Math.round(v * 100) >= 1 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most two decimal places");
