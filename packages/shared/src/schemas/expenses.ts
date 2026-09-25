import { z } from "zod";

// Phase 1 scope: equal split only (docs/PLAN-PUBLIC.md §15). Other split
// methods exist in the schema's enum (apps/api/src/db/schema.ts) for
// Phase 2, but this request shape only supports "equal" for now.
export const createExpenseRequestSchema = z.object({
  description: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  categoryId: z.string().uuid().nullable().optional(),
  expenseDate: z.string().datetime().optional(), // defaults to now if omitted
  paidBy: z.string().uuid(),
  participantUserIds: z.array(z.string().uuid()).min(1),
});
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
