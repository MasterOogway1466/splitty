import {
  formatMoney,
  formatMoneyInput,
  parseMoneyInput,
  todayCalendarDate,
  type CreateExpenseRequest,
  type DefaultSplit,
  type Expense,
  type ExpenseSplit,
  type ShareInput,
} from "@splitty/shared";

export type SplitMethodChoice = ExpenseSplit["splitMethod"];

/** The expense form's contents, exactly as typed. */
export interface ExpenseDraft {
  description: string;
  amount: string;
  expenseDate: string;
  categoryId: string;
  notes: string;
  splitMethod: SplitMethodChoice;
  payerRows: { userId: string; amount: string }[];
  participants: Set<string>;
  participantValues: Record<string, string>;
}

/** `defaultSplit` is used only while everyone in it is still available. */
export function emptyDraft(currentUserId: string, memberIds: string[], defaultSplit: DefaultSplit | null = null): ExpenseDraft {
  const usable = defaultSplit?.values.every((v) => memberIds.includes(v.userId)) ? defaultSplit : null;
  return {
    description: "",
    amount: "",
    expenseDate: todayCalendarDate(),
    categoryId: "",
    notes: "",
    splitMethod: usable?.method ?? "equal",
    payerRows: [{ userId: currentUserId, amount: "" }],
    participants: new Set(usable ? usable.values.map((v) => v.userId) : memberIds),
    participantValues: usable && usable.method !== "equal" ? Object.fromEntries(usable.values.map((v) => [v.userId, String(v.value)])) : {},
  };
}

function shareInputValue(input: ShareInput, currency: string): string {
  switch (input.type) {
    case "exact":
      return formatMoneyInput(input.amountMinor, currency);
    case "percentage":
      return String(input.percentage);
    case "shares":
      return String(input.shares);
    case "adjustment":
      return formatMoneyInput(input.adjustmentMinor, currency);
  }
}

/** Restores what was originally entered. Anyone outside `selectableIds`
 * (e.g. has left the group) is dropped; the form's own checks then ask for
 * the difference to be reassigned. */
export function draftFromExpense(expense: Expense, selectableIds: Set<string>, currentUserId: string): ExpenseDraft {
  const payers = expense.payers.filter((p) => selectableIds.has(p.userId));
  const participants = expense.participants.filter((p) => selectableIds.has(p.userId));
  const values: Record<string, string> = {};
  for (const p of participants) {
    if (p.shareInput) values[p.userId] = shareInputValue(p.shareInput, expense.currency);
  }
  return {
    description: expense.description,
    amount: formatMoneyInput(expense.amountMinor, expense.currency),
    expenseDate: expense.expenseDate,
    categoryId: expense.categoryId ?? "",
    notes: expense.notes ?? "",
    splitMethod: expense.splitMethod as SplitMethodChoice,
    payerRows: payers.length
      ? payers.map((p) => ({ userId: p.userId, amount: formatMoneyInput(p.amountMinor, expense.currency) }))
      : [{ userId: currentUserId, amount: "" }],
    participants: new Set(participants.map((p) => p.userId)),
    participantValues: values,
  };
}

/** The request to send, or what's wrong with the draft. */
export function draftToRequest(draft: ExpenseDraft, currency: string): { request: CreateExpenseRequest } | { error: string } {
  const toMinor = (value: string) => parseMoneyInput(value, currency);
  const valueOf = (id: string) => draft.participantValues[id] || "0";
  const amountMinor = toMinor(draft.amount);
  if (!(amountMinor > 0)) return { error: "Enter a valid amount" };
  const ids = [...draft.participants];
  if (ids.length === 0) return { error: "Pick at least one participant" };

  const single = draft.payerRows.length === 1;
  const payers = draft.payerRows.map((row) => ({ userId: row.userId, amountMinor: single ? amountMinor : toMinor(row.amount) }));
  if (payers.some((p) => !p.userId || !(p.amountMinor > 0))) return { error: "Every payer needs an amount greater than zero" };
  const payersTotal = payers.reduce((s, p) => s + p.amountMinor, 0);
  if (payersTotal !== amountMinor) {
    return { error: `Payer amounts add up to ${formatMoney(payersTotal, currency)}, not ${formatMoney(amountMinor, currency)}` };
  }

  const base = {
    description: draft.description,
    amountMinor,
    currency,
    payers,
    expenseDate: draft.expenseDate,
    categoryId: draft.categoryId || null,
    ...(draft.notes.trim() ? { notes: draft.notes } : {}),
  };

  switch (draft.splitMethod) {
    case "equal":
      return { request: { ...base, splitMethod: "equal", participantUserIds: ids } };
    case "exact": {
      const participants = ids.map((userId) => ({ userId, amountMinor: toMinor(valueOf(userId)) }));
      if (participants.some((p) => !(p.amountMinor > 0))) return { error: "Every participant needs an amount greater than zero" };
      const sum = participants.reduce((s, p) => s + p.amountMinor, 0);
      if (sum !== amountMinor) return { error: `Amounts add up to ${formatMoney(sum, currency)}, not ${formatMoney(amountMinor, currency)}` };
      return { request: { ...base, splitMethod: "exact", participants } };
    }
    case "percentage": {
      const participants = ids.map((userId) => ({ userId, percentage: Number(valueOf(userId)) }));
      if (participants.some((p) => !(p.percentage > 0))) return { error: "Every participant needs a percentage greater than zero" };
      const hundredths = participants.reduce((s, p) => s + Math.round(p.percentage * 100), 0);
      if (hundredths !== 10000) return { error: `Percentages add up to ${hundredths / 100}%, not 100%` };
      return { request: { ...base, splitMethod: "percentage", participants } };
    }
    case "shares": {
      const participants = ids.map((userId) => ({ userId, shares: Number(valueOf(userId)) }));
      if (participants.some((p) => !(p.shares > 0))) return { error: "Every participant needs a positive share count" };
      return { request: { ...base, splitMethod: "shares", participants } };
    }
    case "adjustment": {
      const participants = ids.map((userId) => ({ userId, adjustmentMinor: toMinor(valueOf(userId)) }));
      if (participants.some((p) => !Number.isFinite(p.adjustmentMinor))) return { error: "Enter a valid adjustment for each participant" };
      return { request: { ...base, splitMethod: "adjustment", participants } };
    }
  }
}
