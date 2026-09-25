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

export class NotExpenseParticipantError extends DomainError {
  constructor() {
    super("Not a participant in this expense", "not_expense_participant");
  }
}

export class NotGroupOwnerError extends DomainError {
  constructor() {
    super("Only this group's owner can delete it", "not_group_owner");
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
