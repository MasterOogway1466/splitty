import { z } from "zod";
import { CURRENCY_CODES } from "../currency.js";
import { MAX_AMOUNT_MINOR } from "../money.js";
import { calendarDateSchema } from "./dates.js";
import { uuidv7Schema } from "./ids.js";

export const settlementMethodValues = ["cash", "bank_transfer", "upi", "other"] as const;

export const createSettlementRequestSchema = z.object({
  id: uuidv7Schema.optional(),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  currency: z.enum(CURRENCY_CODES),
  method: z.enum(settlementMethodValues).default("other"),
  note: z.string().trim().max(500).optional(),
  settledAt: calendarDateSchema.optional(), // defaults to today if omitted
}).refine((s) => s.fromUserId !== s.toUserId, "A settlement must be between two different people");
export type CreateSettlementRequest = z.infer<typeof createSettlementRequestSchema>;

// Replaces everything editable; the parties and currency are fixed.
export const updateSettlementRequestSchema = z.object({
  version: z.number().int().positive(),
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  method: z.enum(settlementMethodValues),
  note: z.string().trim().max(500).optional(),
  settledAt: calendarDateSchema,
});
export type UpdateSettlementRequest = z.infer<typeof updateSettlementRequestSchema>;

export const settlementSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  fromUserId: z.string().uuid(),
  fromDisplayName: z.string(),
  toUserId: z.string().uuid(),
  toDisplayName: z.string(),
  currency: z.string(),
  amountMinor: z.number().int(),
  method: z.enum(settlementMethodValues),
  note: z.string().nullable(),
  settledAt: z.string(),
  createdBy: z.string().uuid(),
  version: z.number().int(),
  deletedAt: z.string().nullable(),
});
export type Settlement = z.infer<typeof settlementSchema>;

export const settlementSnapshotSchema = settlementSchema.pick({ amountMinor: true, method: true, note: true, settledAt: true });
export type SettlementSnapshot = z.infer<typeof settlementSnapshotSchema>;

// Both are null for a payment recorded before history was kept.
export const settlementHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  changeType: z.enum(["create", "update", "delete", "restore"]),
  editedBy: z.string().uuid(),
  editedByName: z.string(),
  editedAt: z.string(),
  before: settlementSnapshotSchema.nullable(),
  after: settlementSnapshotSchema.nullable(),
});
export type SettlementHistoryEntry = z.infer<typeof settlementHistoryEntrySchema>;
