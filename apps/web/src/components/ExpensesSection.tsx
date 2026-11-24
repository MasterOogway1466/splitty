import { useState } from "react";
import { Link } from "react-router-dom";
import { formatCalendarDate, formatMoney, todayCalendarDate, type Expense, type GroupDetail } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";
import { draftFromExpense, emptyDraft, type ExpenseDraft } from "../lib/expenseDraft.js";
import { useCreateGroupExpense, useGroupExpenses } from "../lib/hooks.js";
import { personLabel } from "../lib/members.js";
import { ExpenseForm } from "./ExpenseForm.js";
import { SettleForm } from "./SettleForm.js";
import { cardClass, linkButtonClass } from "./styles.js";

export function ExpensesSection({ group }: { group: GroupDetail }) {
  const { user } = useAuth();
  const [showDeleted, setShowDeleted] = useState(false);
  const expensesQuery = useGroupExpenses(group.id, showDeleted);
  const createExpense = useCreateGroupExpense(group.id);
  const [showSettle, setShowSettle] = useState(false);
  // `key` remounts the form, so opening it again starts from the new draft.
  const [form, setForm] = useState<{ key: number; draft: ExpenseDraft } | null>(null);

  const memberIds = group.members.map((m) => m.userId);
  const openForm = (draft: ExpenseDraft) => setForm((prev) => ({ key: (prev?.key ?? 0) + 1, draft }));
  const duplicate = (expense: Expense) =>
    openForm({ ...draftFromExpense(expense, new Set(memberIds), user?.id ?? ""), expenseDate: todayCalendarDate() });

  return (
    <section className={`mb-6 ${cardClass}`}>
      <div className="flex items-center justify-between px-4 py-3.5">
        <h2 className="font-medium text-ink">{showDeleted ? "Deleted expenses" : "Expenses"}</h2>
        <div className="flex gap-4">
          <button onClick={() => setShowSettle((v) => !v)} className={linkButtonClass}>
            Settle up
          </button>
          <button onClick={() => (form ? setForm(null) : openForm(emptyDraft(user?.id ?? "", memberIds)))} className={linkButtonClass}>
            Add expense
          </button>
        </div>
      </div>

      {showSettle && (
        <div className="mx-4 mb-4">
          <SettleForm group={group} onDone={() => setShowSettle(false)} />
        </div>
      )}
      {form && (
        <div className="mx-4 mb-4">
          <ExpenseForm
            key={form.key}
            people={group.members}
            currency={group.defaultCurrency}
            currentUserId={user?.id}
            initial={form.draft}
            submitLabel="Add expense"
            onSubmit={async (request) => {
              await createExpense.mutateAsync(request);
              setForm(null);
            }}
            onCancel={() => setForm(null)}
          />
        </div>
      )}

      {expensesQuery.data?.length === 0 && (
        <p className="text-sm text-ink-muted px-4 pb-4">{showDeleted ? "Nothing deleted." : "No expenses yet."}</p>
      )}
      {expensesQuery.data && expensesQuery.data.length > 0 && (
        <div className="divide-y divide-line border-t border-line">
          {expensesQuery.data.map((expense) => (
            <div key={expense.id} className="text-sm flex items-center justify-between px-4 py-3">
              <div>
                <Link to={`/expenses/${expense.id}`} className="text-ink hover:text-ledger transition-colors">
                  {expense.description}
                </Link>
                <p className="text-xs text-ink-muted">
                  {expense.payers.map((p) => personLabel(p, user?.id)).join(", ")} paid · {formatCalendarDate(expense.expenseDate)}
                  {!showDeleted && (
                    <>
                      {" · "}
                      <button onClick={() => duplicate(expense)} className="hover:text-ledger transition-colors">
                        Duplicate
                      </button>
                    </>
                  )}
                </p>
              </div>
              <span className={`figure font-medium ${showDeleted ? "text-ink-muted line-through" : "text-ink"}`}>
                {formatMoney(expense.amountMinor, expense.currency)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="px-4 py-3 border-t border-line">
        <button onClick={() => setShowDeleted((v) => !v)} className="text-xs text-ink-muted hover:text-ledger transition-colors">
          {showDeleted ? "Back to expenses" : "Show deleted"}
        </button>
      </div>
    </section>
  );
}
