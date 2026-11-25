import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  type Expense,
  type ExpenseHistoryEntry,
  type ExpenseSnapshot,
  type ShareInput,
} from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { ExpenseForm } from "../components/ExpenseForm.js";
import { cardClass, linkButtonClass } from "../components/styles.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { draftFromExpense } from "../lib/expenseDraft.js";
import { useCategories, useExpense, useExpenseHistory, useGroup, useSetExpenseDeleted, useUpdateExpense } from "../lib/hooks.js";
import { personLabel, type Person } from "../lib/members.js";

const CHANGE_LABELS: Record<ExpenseHistoryEntry["changeType"], string> = {
  create: "added this expense",
  update: "edited this expense",
  delete: "deleted this expense",
  restore: "restored this expense",
};

function shareNote(input: ShareInput | null, currency: string): string {
  switch (input?.type) {
    case "percentage":
      return ` (${input.percentage}%)`;
    case "shares":
      return ` (${input.shares} share${input.shares === 1 ? "" : "s"})`;
    case "adjustment":
      return input.adjustmentMinor === 0 ? "" : ` (${input.adjustmentMinor > 0 ? "+" : ""}${formatMoney(input.adjustmentMinor, currency)})`;
    default:
      return "";
  }
}

/** Field-by-field differences between two versions, in words. */
function changesBetween(before: ExpenseSnapshot, after: ExpenseSnapshot, categoryName: (id: string | null) => string): string[] {
  const money = (s: ExpenseSnapshot) => formatMoney(s.amountMinor, s.currency);
  const payers = (s: ExpenseSnapshot) => s.payers.map((p) => `${p.displayName} ${formatMoney(p.amountMinor, s.currency)}`).join(", ");
  const split = (s: ExpenseSnapshot) =>
    s.participants.map((p) => `${p.displayName} ${formatMoney(p.owedAmountMinor, s.currency)}${shareNote(p.shareInput, s.currency)}`).join(", ");
  const fields: [string, string, string][] = [
    ["Description", before.description, after.description],
    ["Amount", money(before), money(after)],
    ["Date", formatCalendarDate(before.expenseDate), formatCalendarDate(after.expenseDate)],
    ["Category", categoryName(before.categoryId), categoryName(after.categoryId)],
    ["Notes", before.notes ?? "none", after.notes ?? "none"],
    ["Paid by", payers(before), payers(after)],
    ["Split", split(before), split(after)],
  ];
  return fields.filter(([, from, to]) => from !== to).map(([label, from, to]) => `${label}: ${from} → ${to}`);
}

export function ExpenseDetailPage() {
  const { expenseId } = useParams<{ expenseId: string }>();
  const expenseQuery = useExpense(expenseId!);

  if (expenseQuery.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-muted">Loading…</p>
      </AppShell>
    );
  }
  if (!expenseQuery.data) {
    return (
      <AppShell>
        <p className="text-sm text-rust">Expense not found, or you don't have access to it.</p>
      </AppShell>
    );
  }
  return <ExpenseDetail key={expenseId} expense={expenseQuery.data} />;
}

function ExpenseDetail({ expense }: { expense: Expense }) {
  const { user } = useAuth();
  const groupQuery = useGroup(expense.groupId);
  const historyQuery = useExpenseHistory(expense.id);
  const categoriesQuery = useCategories();
  const updateExpense = useUpdateExpense(expense.id);
  const setDeleted = useSetExpenseDeleted(expense.id);
  // The version being edited, held still while newer ones may arrive.
  const [editing, setEditing] = useState<Expense | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = groupQuery.data?.members ?? [];
  const ready = expense.groupId === null || groupQuery.data !== undefined;
  const categoryName = (id: string | null) => (id === null ? "none" : (categoriesQuery.data?.find((c) => c.id === id)?.name ?? "unknown"));

  /** Current members, plus anyone already on the expense who has left. */
  function peopleFor(e: Expense): Person[] {
    const people = new Map<string, Person>(members.map((m) => [m.userId, m]));
    for (const p of [...e.payers, ...e.participants]) {
      if (!people.has(p.userId)) {
        people.set(p.userId, { userId: p.userId, displayName: expense.groupId === null ? p.displayName : `${p.displayName} (left)` });
      }
    }
    return [...people.values()];
  }

  async function changeDeleted(deleted: boolean) {
    setError(null);
    setConfirmDelete(false);
    try {
      await setDeleted.mutateAsync({ version: expense.version, deleted });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <AppShell>
      {expense.groupId && (
        <Link to={`/groups/${expense.groupId}`} className={linkButtonClass}>
          ← {groupQuery.data?.name ?? "Group"}
        </Link>
      )}
      {editing ? (
        <div className="mt-3">
          {conflict && (
            <p className="mb-3 text-sm text-rust">
              Someone else changed this expense while you were editing, so your changes weren't saved.{" "}
              <button
                onClick={() => {
                  setConflict(false);
                  setEditing(expense);
                }}
                className="font-medium underline"
              >
                Discard mine and load theirs
              </button>
            </p>
          )}
          <ExpenseForm
            key={editing.version}
            people={peopleFor(editing)}
            currency={editing.currency}
            currentUserId={user?.id}
            initial={draftFromExpense(editing, new Set(peopleFor(editing).map((p) => p.userId)), user?.id ?? "")}
            submitLabel="Save changes"
            onSubmit={async (request) => {
              try {
                await updateExpense.mutateAsync({ ...request, version: editing.version });
                setEditing(null);
              } catch (err) {
                if (err instanceof ApiError && err.code === "version_conflict") setConflict(true);
                throw err;
              }
            }}
            onCancel={() => {
              setConflict(false);
              setEditing(null);
            }}
          />
        </div>
      ) : (
        <section className={`mt-3 p-4 ${cardClass}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-ink">{expense.description}</h1>
              <p className="text-sm text-ink-muted">
                {formatCalendarDate(expense.expenseDate)}
                {expense.categoryId && ` · ${categoryName(expense.categoryId)}`}
              </p>
            </div>
            <span className={`figure text-2xl font-semibold ${expense.deletedAt ? "text-ink-muted line-through" : "text-ink"}`}>
              {formatMoney(expense.amountMinor, expense.currency)}
            </span>
          </div>
          {expense.deletedAt && <p className="mt-2 text-sm text-rust">Deleted. It doesn't count toward anyone's balance.</p>}
          {expense.notes && <p className="mt-3 text-sm text-ink whitespace-pre-wrap">{expense.notes}</p>}
          <dl className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="font-medium text-ink mb-1">Paid</dt>
              {expense.payers.map((p) => (
                <dd key={p.userId} className="flex justify-between text-ink-muted">
                  <span>{personLabel(p, user?.id)}</span>
                  <span className="figure">{formatMoney(p.amountMinor, expense.currency)}</span>
                </dd>
              ))}
            </div>
            <div>
              <dt className="font-medium text-ink mb-1">Owes</dt>
              {expense.participants.map((p) => (
                <dd key={p.userId} className="flex justify-between text-ink-muted">
                  <span>
                    {personLabel(p, user?.id)}
                    {shareNote(p.shareInput, expense.currency)}
                  </span>
                  <span className="figure">{formatMoney(p.owedAmountMinor, expense.currency)}</span>
                </dd>
              ))}
            </div>
          </dl>
          {error && <p className="mt-3 text-sm text-rust">{error}</p>}
          <div className="mt-4 flex items-center gap-4">
            {expense.deletedAt ? (
              <button onClick={() => changeDeleted(false)} disabled={setDeleted.isPending} className={linkButtonClass}>
                Restore
              </button>
            ) : confirmDelete ? (
              <span className="text-sm text-ink-muted">
                Delete this expense?{" "}
                <button onClick={() => changeDeleted(true)} className="text-rust font-medium hover:underline">
                  Confirm
                </button>{" "}
                <button onClick={() => setConfirmDelete(false)} className="hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <button onClick={() => setEditing(expense)} disabled={!ready} className={linkButtonClass}>
                  Edit
                </button>
                <button onClick={() => setConfirmDelete(true)} className={linkButtonClass}>
                  Delete
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {historyQuery.data && (
        <section className={`mt-6 ${cardClass}`}>
          <h2 className="font-medium text-ink px-4 py-3.5 border-b border-line">History</h2>
          <ul className="divide-y divide-line">
            {historyQuery.data.map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm text-ink">
                {entry.editedBy === user?.id ? "You" : entry.editedByName} {CHANGE_LABELS[entry.changeType]}
                <p className="text-xs text-ink-muted">{formatDateTime(new Date(entry.editedAt))}</p>
                {entry.changeType === "update" && entry.before && entry.after && (
                  <ul className="mt-1 text-xs text-ink-muted">
                    {changesBetween(entry.before, entry.after, categoryName).map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
