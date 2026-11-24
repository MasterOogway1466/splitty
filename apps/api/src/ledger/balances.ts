import { and, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { attributeDebts } from "@splitty/shared";
import type { Database } from "../db/client.js";
import { expenseParticipants, expensePayers, expenses, settlements } from "../db/schema.js";

/**
 * docs/PLAN-PUBLIC.md §7: balances are always an aggregation over the raw
 * ledger, never a stored column — computed fresh here on every call, so
 * they can never drift from expense_payers/expense_participants/settlements.
 *
 * Phase 1 currency note: there's no real FX conversion yet (§10 is Phase
 * 3) — `expenses.baseAmountMinor` is set equal to `amountMinor` for now
 * (fx_rate=1, the §2 placeholder). `expense_payers`/`expense_participants`
 * only carry one amount column each (matching §6's schema exactly, no
 * separate base-currency column), which for Phase 1 is fine precisely
 * because currency == base currency. When Phase 3 adds real conversion,
 * those child tables will need their own base-currency columns and these
 * functions will need to switch to summing those instead of the
 * currency-native amounts used here.
 *
 * Because of that, anything that can span more than one currency (pairwise,
 * global) is reported per-currency rather than collapsed into one number —
 * summing different currencies together would silently mix unit systems.
 * Per-group balances stay single-currency because group expense creation
 * is constrained to the group's own default currency in Phase 1.
 */

export type BalanceMap = Map<string, number>;
export type CurrencyBalanceMap = Map<string, number>; // currency -> net minor units

/** Net position (paid − owed, settlement-adjusted) per member, within one
 * group. Positive = the group owes them; negative = they owe the group. */
export async function computeGroupBalances(db: Database, groupId: string): Promise<BalanceMap> {
  const balances: BalanceMap = new Map();
  const add = (userId: string, delta: number) => balances.set(userId, (balances.get(userId) ?? 0) + delta);

  const paidRows = await db
    .select({ userId: expensePayers.userId, amountMinor: expensePayers.amountMinor })
    .from(expensePayers)
    .innerJoin(expenses, eq(expensePayers.expenseId, expenses.id))
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));
  for (const row of paidRows) add(row.userId, row.amountMinor);

  const owedRows = await db
    .select({ userId: expenseParticipants.userId, owedAmountMinor: expenseParticipants.owedAmountMinor })
    .from(expenseParticipants)
    .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));
  for (const row of owedRows) add(row.userId, -row.owedAmountMinor);

  const settlementRows = await db
    .select({ fromUserId: settlements.fromUserId, toUserId: settlements.toUserId, amountMinor: settlements.amountMinor })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)));
  for (const row of settlementRows) {
    // Paying down a debt moves you toward zero/positive; receiving a
    // payment reduces what's owed to you.
    add(row.fromUserId, row.amountMinor);
    add(row.toUserId, -row.amountMinor);
  }

  return balances;
}

/**
 * Pairwise net balance between exactly two users, aggregated across every
 * group they share plus any direct (non-group) expenses/settlements
 * between them — docs/PLAN-PUBLIC.md §1's "total balance with a person
 * aggregated across multiple groups plus non-group expenses." Positive
 * entries mean `otherUserId` owes `userId`; negative means the reverse.
 *
 * Expenses are attributed through `attributeDebts` (§7), so a person's
 * pairwise balances always sum to their global balance.
 */
export async function computePairwiseBalances(db: Database, userId: string, otherUserId: string): Promise<CurrencyBalanceMap> {
  return (await computeAllPairwiseBalances(db, userId)).get(otherUserId) ?? new Map();
}

/** computePairwiseBalances against every counterparty at once, keyed by
 * their user id. */
export async function computeAllPairwiseBalances(db: Database, userId: string): Promise<Map<string, CurrencyBalanceMap>> {
  const result = new Map<string, CurrencyBalanceMap>();
  const add = (otherUserId: string, currency: string, delta: number) => {
    const net = result.get(otherUserId) ?? new Map<string, number>();
    net.set(currency, (net.get(currency) ?? 0) + delta);
    result.set(otherUserId, net);
  };

  // Attribution needs every payer and participant of an expense, not just
  // the two people being compared.
  const involvesUser = and(
    isNull(expenses.deletedAt),
    or(
      exists(db.select({ one: sql`1` }).from(expensePayers).where(and(eq(expensePayers.expenseId, expenses.id), eq(expensePayers.userId, userId)))),
      exists(
        db
          .select({ one: sql`1` })
          .from(expenseParticipants)
          .where(and(eq(expenseParticipants.expenseId, expenses.id), eq(expenseParticipants.userId, userId))),
      ),
    ),
  );
  const myExpenses = await db.select({ id: expenses.id, currency: expenses.currency }).from(expenses).where(involvesUser);

  if (myExpenses.length > 0) {
    const expenseIds = myExpenses.map((e) => e.id);
    const netsByExpense = new Map(expenseIds.map((id) => [id, new Map<string, number>()]));
    const addNet = (expenseId: string, memberId: string, delta: number) => {
      const nets = netsByExpense.get(expenseId)!;
      nets.set(memberId, (nets.get(memberId) ?? 0) + delta);
    };
    const paidRows = await db.select().from(expensePayers).where(inArray(expensePayers.expenseId, expenseIds));
    for (const row of paidRows) addNet(row.expenseId, row.userId, row.amountMinor);
    const owedRows = await db.select().from(expenseParticipants).where(inArray(expenseParticipants.expenseId, expenseIds));
    for (const row of owedRows) addNet(row.expenseId, row.userId, -row.owedAmountMinor);

    for (const expense of myExpenses) {
      for (const debt of attributeDebts(netsByExpense.get(expense.id)!)) {
        if (debt.toId === userId) add(debt.fromId, expense.currency, debt.amountMinor);
        else if (debt.fromId === userId) add(debt.toId, expense.currency, -debt.amountMinor);
      }
    }
  }

  const settlementRows = await db
    .select()
    .from(settlements)
    .where(and(isNull(settlements.deletedAt), or(eq(settlements.fromUserId, userId), eq(settlements.toUserId, userId))));
  for (const row of settlementRows) {
    // A self-settlement moves nothing between two people.
    if (row.fromUserId === row.toUserId) continue;
    // userId paid the other -> the other's net debt to userId goes up
    // (toward less negative / more positive).
    if (row.fromUserId === userId) add(row.toUserId, row.currency, row.amountMinor);
    else add(row.fromUserId, row.currency, -row.amountMinor);
  }

  return result;
}

/** Global net position for one user across every group and direct expense
 * they're part of, per currency — the "you owe / you're owed" dashboard
 * summary from docs/PLAN-PUBLIC.md §1. */
export async function computeGlobalBalances(db: Database, userId: string): Promise<CurrencyBalanceMap> {
  const net: CurrencyBalanceMap = new Map();
  const add = (currency: string, delta: number) => net.set(currency, (net.get(currency) ?? 0) + delta);

  const paidRows = await db
    .select({ currency: expenses.currency, amountMinor: expensePayers.amountMinor })
    .from(expensePayers)
    .innerJoin(expenses, eq(expensePayers.expenseId, expenses.id))
    .where(and(eq(expensePayers.userId, userId), isNull(expenses.deletedAt)));
  for (const row of paidRows) add(row.currency, row.amountMinor);

  const owedRows = await db
    .select({ currency: expenses.currency, owedAmountMinor: expenseParticipants.owedAmountMinor })
    .from(expenseParticipants)
    .innerJoin(expenses, eq(expenseParticipants.expenseId, expenses.id))
    .where(and(eq(expenseParticipants.userId, userId), isNull(expenses.deletedAt)));
  for (const row of owedRows) add(row.currency, -row.owedAmountMinor);

  const settlementRows = await db
    .select({ currency: settlements.currency, amountMinor: settlements.amountMinor, fromUserId: settlements.fromUserId, toUserId: settlements.toUserId })
    .from(settlements)
    .where(and(isNull(settlements.deletedAt), or(eq(settlements.fromUserId, userId), eq(settlements.toUserId, userId))));
  for (const row of settlementRows) {
    if (row.fromUserId === row.toUserId) continue;
    add(row.currency, row.fromUserId === userId ? row.amountMinor : -row.amountMinor);
  }

  return net;
}
