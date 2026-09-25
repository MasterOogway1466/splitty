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
