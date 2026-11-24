import { z } from "zod";

/** A client-generated, time-ordered id (docs/PLAN-PUBLIC.md §8). */
export const uuidv7Schema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "id must be a lowercase UUIDv7");
