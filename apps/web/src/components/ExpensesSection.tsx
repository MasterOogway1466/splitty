import { useState } from "react";
import { todayCalendarDate, type Expense, type GroupDetail } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";
import { draftFromExpense, emptyDraft, type ExpenseDraft } from "../lib/expenseDraft.js";
import { useCreateExpense, useCreateSettlement, useExpenses, useGroupDebts } from "../lib/hooks.js";
import { ExpenseForm } from "./ExpenseForm.js";
import { ExpenseRows } from "./ExpenseRows.js";
import { LoadMore } from "./LoadMore.js";
import { SettleForm } from "./SettleForm.js";
import { cardClass, linkButtonClass } from "./styles.js";

export function ExpensesSection({ group }: { group: GroupDetail }) {
  const { user } = useAuth();
  const [showDeleted, setShowDeleted] = useState(false);
  const expensesQuery = useExpenses({ groupId: group.id }, showDeleted);
  const createExpense = useCreateExpense(group.id);
  const createSettlement = useCreateSettlement(group.id);
  const debtsQuery = useGroupDebts(group.id);
  const expenses = expensesQuery.data?.pages.flatMap((p) => p.items) ?? [];
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

      {showSettle && debtsQuery.data && (
        <div className="mx-4 mb-4">
          <SettleForm
            people={group.members}
            currency={group.defaultCurrency}
            currentUserId={user?.id}
            suggestions={debtsQuery.data}
            onSubmit={async (request) => {
              await createSettlement.mutateAsync(request);
              setShowSettle(false);
            }}
            onCancel={() => setShowSettle(false)}
          />
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

      {expensesQuery.data && expenses.length === 0 && (
        <p className="text-sm text-ink-muted px-4 pb-4">{showDeleted ? "Nothing deleted." : "No expenses yet."}</p>
      )}
      {expenses.length > 0 && <ExpenseRows expenses={expenses} onDuplicate={duplicate} />}
      <LoadMore query={expensesQuery} />
      <div className="px-4 py-3 border-t border-line">
        <button onClick={() => setShowDeleted((v) => !v)} className="text-xs text-ink-muted hover:text-ledger transition-colors">
          {showDeleted ? "Back to expenses" : "Show deleted"}
        </button>
      </div>
    </section>
  );
}
