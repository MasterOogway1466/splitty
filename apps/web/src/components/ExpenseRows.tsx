import { formatCalendarDate, formatMoney, type Expense } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";
import { personLabel } from "../lib/members.js";
import { Button, RowChevron, RowLink, rowClass } from "./Button.js";

export function ExpenseRows({ expenses, onDuplicate }: { expenses: Expense[]; onDuplicate: ((expense: Expense) => void) | null }) {
  const { user } = useAuth();
  return (
    <div className="divide-y divide-line border-t border-line">
      {expenses.map((expense) => (
        <div key={expense.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${rowClass}`}>
          <div className="min-w-0 flex-1">
            <RowLink to={`/expenses/${expense.id}`} className="break-words">
              {expense.description}
            </RowLink>
            <p className="text-xs text-ink-muted">
              {expense.payers.map((p) => personLabel(p, user?.id)).join(", ")} paid, {formatCalendarDate(expense.expenseDate)}
            </p>
          </div>
          <span className={`figure font-medium ${expense.deletedAt ? "text-ink-muted line-through" : "text-ink"}`}>
            {formatMoney(expense.amountMinor, expense.currency)}
          </span>
          {!expense.deletedAt && onDuplicate && (
            <Button
              size="xs"
              icon="copy"
              className="relative"
              aria-label={`Duplicate ${expense.description}`}
              title="Duplicate"
              onClick={() => onDuplicate(expense)}
            >
              <span className="hidden sm:inline">Duplicate</span>
            </Button>
          )}
          <RowChevron />
        </div>
      ))}
    </div>
  );
}
