import { useState } from "react";
import { useParams } from "react-router-dom";
import { CURRENCY_CODES, formatMoney, todayCalendarDate, type BalanceContext, type PersonBalance, type UserProfile } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { BackLink, Button, DisclosureButton, TextLink } from "../components/Button.js";
import { ExpenseForm } from "../components/ExpenseForm.js";
import { ExpenseRows } from "../components/ExpenseRows.js";
import { LoadMore } from "../components/LoadMore.js";
import { SettleForm } from "../components/SettleForm.js";
import { SettlementsSection } from "../components/SettlementsSection.js";
import { cardClass } from "../components/styles.js";
import { useAuth } from "../lib/AuthContext.js";
import { draftFromExpense, emptyDraft, type ExpenseDraft } from "../lib/expenseDraft.js";
import { useCreateExpense, useCreateSettlement, useExpenses, usePerson } from "../lib/hooks.js";
import type { Person } from "../lib/members.js";

export function PersonPage() {
  const { personId } = useParams<{ personId: string }>();
  const { user } = useAuth();
  const personQuery = usePerson(personId!);

  if (personQuery.isLoading || !user) {
    return (
      <AppShell>
        <p className="text-sm text-ink-muted">Loading…</p>
      </AppShell>
    );
  }
  if (!personQuery.data) {
    return (
      <AppShell>
        <p className="text-sm text-rust">Person not found.</p>
      </AppShell>
    );
  }
  return <PersonDetail key={personId} person={personQuery.data} me={user} />;
}

type OpenForm =
  | { kind: "expense"; key: number; draft: ExpenseDraft; currency: string; submitLabel: string }
  | { kind: "settle"; context: BalanceContext };

function PersonDetail({ person, me }: { person: PersonBalance; me: UserProfile }) {
  const scope = { personId: person.userId };
  const [showDeleted, setShowDeleted] = useState(false);
  const expensesQuery = useExpenses(scope, showDeleted);
  const createExpense = useCreateExpense(null);
  const [form, setForm] = useState<OpenForm | null>(null);

  const people: Person[] = [
    { userId: me.id, displayName: me.displayName },
    { userId: person.userId, displayName: person.displayName },
  ];
  const ids = people.map((p) => p.userId);
  const expenses = expensesQuery.data?.pages.flatMap((p) => p.items) ?? [];

  const openExpense = (draft: ExpenseDraft, currency: string, submitLabel: string) =>
    setForm((prev) => ({ kind: "expense", key: prev?.kind === "expense" ? prev.key + 1 : 1, draft, currency, submitLabel }));

  return (
    <AppShell>
      <BackLink to="/friends">Friends</BackLink>
      <h1 className="text-xl font-semibold text-ink mt-3 mb-4">{person.displayName}</h1>

      <section className={`mb-6 ${cardClass}`}>
        <h2 className="font-medium text-ink px-4 py-3.5">Balance</h2>
        {person.contexts.length === 0 ? (
          <p className="text-sm text-ink-muted px-4 pb-4">You're settled up.</p>
        ) : (
          <div className="divide-y divide-line border-t border-line">
            {person.contexts.map((context) => (
              <div key={`${context.groupId}:${context.currency}`} className="text-sm flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
                <span className="text-ink">
                  {context.groupId ? <TextLink to={`/groups/${context.groupId}`}>{context.groupName}</TextLink> : "Direct"}
                </span>
                <span className="flex items-center gap-3">
                  <span className={context.netMinor > 0 ? "text-ledger" : "text-rust"}>
                    {context.netMinor > 0 ? "owes you " : "you owe "}
                    <span className="figure font-medium">{formatMoney(Math.abs(context.netMinor), context.currency)}</span>
                  </span>
                  <Button icon="settle" onClick={() => setForm({ kind: "settle", context })}>
                    Settle up
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
        {form?.kind === "settle" && (
          <div className="mx-4 my-4">
            <SettleHere
              key={`${form.context.groupId}:${form.context.currency}`}
              context={form.context}
              people={people}
              me={me.id}
              personId={person.userId}
              onClose={() => setForm(null)}
            />
          </div>
        )}
      </section>

      <section className={`mb-6 ${cardClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-medium text-ink">{showDeleted ? "Deleted direct expenses" : "Direct expenses"}</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              icon="plus"
              onClick={() =>
                openExpense({ ...emptyDraft(me.id, [person.userId]), description: "IOU" }, me.defaultCurrency, "Record IOU")
              }
            >
              Record an IOU
            </Button>
            <Button variant="primary" icon="plus" onClick={() => openExpense(emptyDraft(me.id, ids), me.defaultCurrency, "Add expense")}>
              Add expense
            </Button>
          </div>
        </div>
        {form?.kind === "expense" && (
          <div className="mx-4 mb-4">
            <label className="mb-2 flex items-center gap-2 text-sm text-ink">
              Currency
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="rounded-md border border-edge bg-white px-2 py-1 text-sm"
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <ExpenseForm
              key={form.key}
              people={people}
              currency={form.currency}
              currentUserId={me.id}
              initial={form.draft}
              submitLabel={form.submitLabel}
              onSubmit={async (request) => {
                await createExpense.mutateAsync(request);
                setForm(null);
              }}
              onCancel={() => setForm(null)}
            />
          </div>
        )}
        {expensesQuery.data && expenses.length === 0 && (
          <p className="text-sm text-ink-muted px-4 pb-4">{showDeleted ? "Nothing deleted." : "Nothing outside your groups yet."}</p>
        )}
        {expenses.length > 0 && (
          <ExpenseRows
            expenses={expenses}
            onDuplicate={(e) =>
              openExpense({ ...draftFromExpense(e, new Set(ids), me.id), expenseDate: todayCalendarDate() }, e.currency, "Add expense")
            }
          />
        )}
        <LoadMore query={expensesQuery} />
        <div className="border-t border-line">
          <DisclosureButton open={showDeleted} onClick={() => setShowDeleted((v) => !v)}>
            {showDeleted ? "Back to expenses" : "Show deleted"}
          </DisclosureButton>
        </div>
      </section>

      <SettlementsSection scope={scope} />
    </AppShell>
  );
}

function SettleHere(props: { context: BalanceContext; people: Person[]; me: string; personId: string; onClose: () => void }) {
  const { context, people, me, personId } = props;
  const createSettlement = useCreateSettlement(context.groupId);
  const [fromUserId, toUserId] = context.netMinor > 0 ? [personId, me] : [me, personId];
  return (
    <SettleForm
      people={people}
      currency={context.currency}
      currentUserId={me}
      suggestions={[{ fromUserId, toUserId, amountMinor: Math.abs(context.netMinor) }]}
      onSubmit={async (request) => {
        await createSettlement.mutateAsync(request);
        props.onClose();
      }}
      onCancel={props.onClose}
    />
  );
}
