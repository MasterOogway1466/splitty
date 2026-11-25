import { Link } from "react-router-dom";
import { formatCalendarDate, formatMoney, type Expense } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";
import { personLabel } from "../lib/members.js";

export function ExpenseRows({ expenses, onDuplicate }: { expenses: Expense[]; onDuplicate: ((expense: Expense) => void) | null }) {
  const { user } = useAuth();
  return (
    <div className="divide-y divide-line border-t border-line">
      {expenses.map((expense) => (
        <div key={expense.id} className="text-sm flex items-center justify-between px-4 py-3">
          <div>
            <Link to={`/expenses/${expense.id}`} className="text-ink hover:text-ledger transition-colors">
              {expense.description}
            </Link>
            <p className="text-xs text-ink-muted">
              {expense.payers.map((p) => personLabel(p, user?.id)).join(", ")} paid · {formatCalendarDate(expense.expenseDate)}
              {!expense.deletedAt && onDuplicate && (
                <>
                  {" · "}
                  <button onClick={() => onDuplicate(expense)} className="hover:text-ledger transition-colors">
                    Duplicate
                  </button>
                </>
              )}
            </p>
          </div>
          <span className={`figure font-medium ${expense.deletedAt ? "text-ink-muted line-through" : "text-ink"}`}>
            {formatMoney(expense.amountMinor, expense.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
