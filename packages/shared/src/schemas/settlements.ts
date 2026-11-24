import { z } from "zod";
import { CURRENCY_CODES } from "../currency.js";

export const settlementMethodValues = ["cash", "bank_transfer", "upi", "other"] as const;

export const createSettlementRequestSchema = z.object({
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  currency: z.enum(CURRENCY_CODES),
  method: z.enum(settlementMethodValues).default("other"),
  note: z.string().trim().max(500).optional(),
  settledAt: z.string().datetime().optional(),
}).refine((s) => s.fromUserId !== s.toUserId, "A settlement must be between two different people");
export type CreateSettlementRequest = z.infer<typeof createSettlementRequestSchema>;

export const settlementSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  currency: z.string(),
  amountMinor: z.number().int(),
  method: z.string(),
  note: z.string().nullable(),
  settledAt: z.string(),
  createdBy: z.string().uuid(),
});
export type Settlement = z.infer<typeof settlementSchema>;
