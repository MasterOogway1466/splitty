import type { expenses, settlements } from "../db/schema.js";

export class DomainError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export class GroupNotFoundError extends DomainError {
  constructor() {
    super("Group not found", "group_not_found");
  }
}

/** docs/PLAN-PUBLIC.md §5: data isolation as an enforced, tested
 * invariant — thrown by every group-scoped lookup for a user who isn't a
 * current member, so a non-member gets the same response whether the
 * group exists or not (no existence leak). */
export class NotGroupMemberError extends DomainError {
  constructor() {
    super("Not a member of this group", "not_group_member");
  }
}

export class AlreadyMemberError extends DomainError {
  constructor() {
    super("This person is already a member of the group", "already_member");
  }
}

/** docs/PLAN-PUBLIC.md §6: removal blocked while the member's net balance
 * within that group is nonzero. */
export class NonzeroBalanceError extends DomainError {
  readonly balanceMinor: number;
  constructor(balanceMinor: number) {
    super("This member has a nonzero balance in the group and cannot be removed yet", "nonzero_balance");
    this.balanceMinor = balanceMinor;
  }
}

/** Group balances are a single-currency sum until real FX lands
 * (docs/PLAN-PUBLIC.md §10), so a group's entries must use its currency. */
export class CurrencyMismatchError extends DomainError {
  constructor(expected: string) {
    super(`This group only accepts entries in ${expected}`, "currency_mismatch");
  }
}

export class NotExpenseParticipantError extends DomainError {
  constructor() {
    super("Not a participant in this expense", "not_expense_participant");
  }
}

/** docs/PLAN-PUBLIC.md §8: this id already belongs to a different entry. */
export class IdConflictError extends DomainError {
  constructor() {
    super("This id has already been used for a different entry", "id_conflict");
  }
}

export class ExpenseNotFoundError extends DomainError {
  constructor() {
    super("Expense not found", "expense_not_found");
  }
}

export class SettlementNotFoundError extends DomainError {
  constructor() {
    super("Payment not found", "settlement_not_found");
  }
}

/** e.g. editing something deleted. */
export class WrongStateError extends DomainError {
  constructor(message: string) {
    super(message, "wrong_state");
  }
}

export type ChangedRow = { expense: typeof expenses.$inferSelect } | { settlement: typeof settlements.$inferSelect };

/** The caller edited a version that is no longer current; `current` is what
 * replaced it. */
export class VersionConflictError extends DomainError {
  readonly current: ChangedRow;
  constructor(current: ChangedRow) {
    super("Someone else changed this in the meantime", "version_conflict");
    this.current = current;
  }
}

/** docs/PLAN-PUBLIC.md §7: their balance was zero when they left and must
 * stay that way unless they rejoin. */
export class AffectsFormerMemberError extends DomainError {
  constructor() {
    super("This would change the balance of someone who has left the group. Add them back first.", "affects_former_member");
  }
}

export class NotConnectedError extends DomainError {
  constructor() {
    super("You can only add people you share a group with or have split with before", "not_connected");
  }
}

export class NotGroupOwnerError extends DomainError {
  constructor() {
    super("Only this group's owner can do this", "not_group_owner");
  }
}

/** Like NonzeroBalanceError but for deleting a whole group: every
 * member's balance must be zero, not just one target member's. */
export class GroupNotSettledError extends DomainError {
  constructor() {
    super("Everyone in this group must be settled up before it can be deleted", "group_not_settled");
  }
}

/** Thrown when a split's own numbers don't add up — payers not
 * summing to the total, exact/percentage participants not summing
 * correctly, adjustments exceeding the total, or a duplicate userId
 * anywhere in the split. Always a 400 via the generic DomainError
 * branch in app.ts's error handler. */
export class InvalidSplitError extends DomainError {
  constructor(message: string) {
    super(message, "invalid_split");
  }
}

export class PersonNotFoundError extends DomainError {
  constructor() {
    super("Person not found", "person_not_found");
  }
}
