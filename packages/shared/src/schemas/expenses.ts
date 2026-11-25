import { z } from "zod";
import { CURRENCY_CODES } from "../currency.js";
import { MAX_AMOUNT_MINOR, MAX_SHARES } from "../money.js";
import { calendarDateSchema } from "./dates.js";
import { hundredthsSchema } from "./numbers.js";
import { uuidv7Schema } from "./ids.js";

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
  participants: z.array(z.object({ userId: z.string().uuid(), percentage: hundredthsSchema(100) })).min(1).max(MAX_PEOPLE),
});
const sharesSplitSchema = z.object({
  splitMethod: z.literal("shares"),
  participants: z.array(z.object({ userId: z.string().uuid(), shares: hundredthsSchema(MAX_SHARES) })).min(1).max(MAX_PEOPLE),
});
const adjustmentSplitSchema = z.object({
  splitMethod: z.literal("adjustment"),
  participants: z.array(z.object({ userId: z.string().uuid(), adjustmentMinor: z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR) })).min(1).max(MAX_PEOPLE),
});

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
  assignments: z.array(z.object({ userId: z.string().uuid(), shares: hundredthsSchema(MAX_SHARES) })).min(1).max(100),
});
const itemizationSchema = z.object({
  items: z.array(lineItemSchema).min(1).max(100),
  // Spread over people in proportion to their items.
  taxMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR).default(0),
  tipMinor: z.number().int().min(0).max(MAX_AMOUNT_MINOR).default(0),
});
export type Itemization = z.infer<typeof itemizationSchema>;
const MAX_ASSIGNMENTS = 500;
const itemizedSplitSchema = itemizationSchema.extend({
  splitMethod: z.literal("itemized"),
  items: itemizationSchema.shape.items.refine(
    (items) => items.reduce((sum, i) => sum + i.assignments.length, 0) <= MAX_ASSIGNMENTS,
    `At most ${MAX_ASSIGNMENTS} item assignments`,
  ),
});

export const splitSchema = z.discriminatedUnion("splitMethod", [
  equalSplitSchema,
  exactSplitSchema,
  percentageSplitSchema,
  sharesSplitSchema,
  adjustmentSplitSchema,
  itemizedSplitSchema,
]);
export type ExpenseSplit = z.infer<typeof splitSchema>;

const expenseFieldsSchema = z.object({
    description: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).optional(),
    amountMinor: z.number().int().positive().max(MAX_AMOUNT_MINOR),
    currency: z.enum(CURRENCY_CODES),
    categoryId: z.string().uuid().nullable().optional(),
    expenseDate: calendarDateSchema.optional(), // defaults to today if omitted
    payers: z.array(payerSchema).min(1).max(MAX_PEOPLE),
});

export const createExpenseRequestSchema = expenseFieldsSchema.extend({ id: uuidv7Schema.optional() }).and(splitSchema);
export type CreateExpenseRequest = z.infer<typeof createExpenseRequestSchema>;

// Replaces the whole expense. `version` is the one being edited, so a change
// made by someone else in the meantime isn't silently overwritten.
export const updateExpenseRequestSchema = expenseFieldsSchema.extend({ version: z.number().int().positive() }).and(splitSchema);
export type UpdateExpenseRequest = z.infer<typeof updateExpenseRequestSchema>;

export const versionRequestSchema = z.object({ version: z.number().int().positive() });

/** What was entered for a participant, as opposed to what it came to. */
export const shareInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact"), amountMinor: z.number().int() }),
  z.object({ type: z.literal("percentage"), percentage: z.number() }),
  z.object({ type: z.literal("shares"), shares: z.number() }),
  z.object({ type: z.literal("adjustment"), adjustmentMinor: z.number().int() }),
  // What their items came to, before tax and tip.
  z.object({ type: z.literal("itemized"), subtotalMinor: z.number().int() }),
]);
export type ShareInput = z.infer<typeof shareInputSchema>;

export const expenseParticipantSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  owedAmountMinor: z.number().int(),
  shareInput: shareInputSchema.nullable(),
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
  itemization: itemizationSchema.nullable(),
  createdAt: z.string(),
  version: z.number().int(),
  deletedAt: z.string().nullable(),
});
export type Expense = z.infer<typeof expenseSchema>;

export const expenseSnapshotSchema = expenseSchema.pick({
  description: true,
  notes: true,
  categoryId: true,
  currency: true,
  amountMinor: true,
  splitMethod: true,
  expenseDate: true,
  payers: true,
  participants: true,
  itemization: true,
});
export type ExpenseSnapshot = z.infer<typeof expenseSnapshotSchema>;

// Both are null for entries recorded before full versions were kept.
export const expenseHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  changeType: z.enum(["create", "update", "delete", "restore"]),
  editedBy: z.string().uuid(),
  editedByName: z.string(),
  editedAt: z.string(),
  before: expenseSnapshotSchema.nullable(),
  after: expenseSnapshotSchema.nullable(),
});
export type ExpenseHistoryEntry = z.infer<typeof expenseHistoryEntrySchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  icon: z.string().nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const createCommentRequestSchema = z.object({
  id: uuidv7Schema.optional(),
  body: z.string().trim().min(1).max(2000),
});
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const commentSchema = z.object({
  id: z.string().uuid(),
  expenseId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof commentSchema>;
