import { z } from "zod";
import { CURRENCY_CODES } from "../currency.js";
import { MAX_AMOUNT_MINOR, MAX_SHARES } from "../money.js";

const MAX_PEOPLE = 500;

const payerSchema = z.object({ userId: z.string().uuid(), amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR) });

const equalSplitSchema = z.object({
  splitMethod: z.literal("equal"),
  participantUserIds: z.array(z.string().uuid()).min(1).max(MAX_PEOPLE),
});
const exactSplitSchema = z.object({
  splitMethod: z.literal("exact"),
  participants: z.array(z.object({ userId: z.string().uuid(), amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR) })).min(1).max(MAX_PEOPLE),
});
const percentageSplitSchema = z.object({
  splitMethod: z.literal("percentage"),
  participants: z.array(z.object({ userId: z.string().uuid(), percentage: z.number().positive().max(100) })).min(1).max(MAX_PEOPLE),
});
const sharesSplitSchema = z.object({
  splitMethod: z.literal("shares"),
  participants: z.array(z.object({ userId: z.string().uuid(), shares: z.number().positive().max(MAX_SHARES) })).min(1).max(MAX_PEOPLE),
});
const adjustmentSplitSchema = z.object({
  splitMethod: z.literal("adjustment"),
  participants: z.array(z.object({ userId: z.string().uuid(), adjustmentMinor: z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR) })).min(1).max(MAX_PEOPLE),
});

// Phase 2 scope: equal/exact/percentage/shares/adjustment. Itemized
// exists in the DB enum (apps/api/src/db/schema.ts) but has no request
// shape here yet — it needs its own line-items UI (deferred).
export const splitSchema = z.discriminatedUnion("splitMethod", [
  equalSplitSchema,
  exactSplitSchema,
  percentageSplitSchema,
  sharesSplitSchema,
  adjustmentSplitSchema,
]);
export type ExpenseSplit = z.infer<typeof splitSchema>;

export const createExpenseRequestSchema = z
  .object({
    description: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).optional(),
    amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
    currency: z.enum(CURRENCY_CODES),
    categoryId: z.string().uuid().nullable().optional(),
    expenseDate: z.string().datetime().optional(), // defaults to now if omitted
    payers: z.array(payerSchema).min(1).max(MAX_PEOPLE),
  })
  .and(splitSchema);
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

export const expenseParticipantSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  owedAmountMinor: z.number().int(),
});

export const expensePayerSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  amountMinor: z.number().int(),
});

export const expenseSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid().nullable(),
  description: z.string(),
  notes: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  currency: z.string(),
  amountMinor: z.number().int(),
  splitMethod: z.string(),
  expenseDate: z.string(),
  createdBy: z.string().uuid(),
  payers: z.array(expensePayerSchema),
  participants: z.array(expenseParticipantSchema),
  createdAt: z.string(),
});
export type Expense = z.infer<typeof expenseSchema>;
