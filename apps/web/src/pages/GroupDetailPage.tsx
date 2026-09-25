import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatDate, formatMoney, memberColorValues, type CreateExpenseRequest, type MemberColor } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import {
  useAddGroupMember,
  useCreateGroupExpense,
  useCreateGroupSettlement,
  useDeleteGroup,
  useGroup,
  useGroupExpenses,
  useLeaveGroup,
  useRemoveGroupMember,
  useSetMemberColor,
} from "../lib/hooks.js";

// A muted, paper-friendly palette distinct from the app's own ledger
// green / rust semantic colors, so a member's chosen color is never
// mistaken for a balance direction.
const COLOR_SWATCH_CLASS: Record<MemberColor, string> = {
  red: "bg-[#c1443a]",
  orange: "bg-[#c97a35]",
  amber: "bg-[#c99a3b]",
  green: "bg-[#3f7d5c]",
  teal: "bg-[#2f8f80]",
  blue: "bg-[#3b6fa6]",
  indigo: "bg-[#5a5fa6]",
  purple: "bg-[#7a5aa6]",
  pink: "bg-[#b85a8a]",
  slate: "bg-[#6b7280]",
};

const inputClass =
  "w-full rounded-md border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger";
const primaryButtonClass = "rounded-md bg-ledger text-paper text-sm font-medium px-4 py-2 hover:bg-ledger-dark transition-colors disabled:opacity-50";
const linkButtonClass = "text-sm text-ink-muted hover:text-ledger transition-colors";

type SplitMethodChoice = "equal" | "exact" | "percentage" | "shares" | "adjustment";
const SPLIT_METHOD_LABELS: Record<SplitMethodChoice, string> = {
  equal: "Equal",
  exact: "Exact",
  percentage: "%",
  shares: "Shares",
  adjustment: "+/−",
};

function toMinor(dollars: string): number {
  return Math.round(Number(dollars) * 100);
}

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const groupQuery = useGroup(groupId!);
  const expensesQuery = useGroupExpenses(groupId!);
  const addMember = useAddGroupMember(groupId!);
  const removeMember = useRemoveGroupMember(groupId!);
  const createExpense = useCreateGroupExpense(groupId!);
  const createSettlement = useCreateGroupSettlement(groupId!);
  const leaveGroup = useLeaveGroup(groupId!);
  const deleteGroup = useDeleteGroup(groupId!);
  const setMemberColor = useSetMemberColor(groupId!);

  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [splitMethod, setSplitMethod] = useState<SplitMethodChoice>("equal");
  const [participantValues, setParticipantValues] = useState<Record<string, string>>({});
  const [payerRows, setPayerRows] = useState<{ userId: string; amount: string }[]>([{ userId: user?.id ?? "", amount: "" }]);
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);

  const [settleFrom, setSettleFrom] = useState("");
  const [settleTo, setSettleTo] = useState("");
  const [settleAmount, setSettleAmount] = useState("");
  const [showSettle, setShowSettle] = useState(false);

  if (groupQuery.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-muted">Loading…</p>
      </AppShell>
    );
  }
  if (groupQuery.isError || !groupQuery.data) {
    return (
      <AppShell>
        <p className="text-sm text-rust">Group not found, or you don't have access to it.</p>
      </AppShell>
    );
  }
  const group = groupQuery.data;
  const currency = group.defaultCurrency;

  function nameFor(m: { userId: string; displayName: string; color?: MemberColor | null }) {
    const tags = [m.userId === user?.id ? "you" : null, m.color ?? null].filter((t): t is string => t !== null);
    return tags.length ? `${m.displayName} (${tags.join(", ")})` : m.displayName;
  }

  function toggleParticipant(userId: string) {
    setParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    setMemberError(null);
    try {
      await addMember.mutateAsync(memberEmail);
      setMemberEmail("");
      setShowAddMember(false);
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function handleAddExpense(e: FormEvent) {
    e.preventDefault();
    setExpenseError(null);
    const amountMinor = Math.round(Number(expenseAmount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setExpenseError("Enter a valid amount");
      return;
    }
    if (participants.size === 0) {
      setExpenseError("Pick at least one participant");
      return;
    }

    if (payerRows.some((row) => !row.userId || (payerRows.length > 1 && !(toMinor(row.amount) > 0)))) {
      setExpenseError("Every payer needs an amount greater than zero");
      return;
    }
    const payers =
      payerRows.length === 1
        ? [{ userId: payerRows[0]!.userId, amountMinor }]
        : payerRows.map((row) => ({ userId: row.userId, amountMinor: toMinor(row.amount) }));
    if (payerRows.length > 1) {
      const payersTotal = payers.reduce((s, p) => s + p.amountMinor, 0);
      if (payersTotal !== amountMinor) {
        setExpenseError(`Payer amounts add up to ${formatMoney(payersTotal, currency)}, not ${formatMoney(amountMinor, currency)}`);
        return;
      }
    }

    const participantIds = [...participants];
    const base = { description: expenseDescription, amountMinor, currency, payers };
    let payload: CreateExpenseRequest;
    if (splitMethod === "equal") {
      payload = { ...base, splitMethod: "equal", participantUserIds: participantIds };
    } else if (splitMethod === "exact") {
      const parts = participantIds.map((userId) => ({ userId, amountMinor: toMinor(participantValues[userId] || "0") }));
      const sum = parts.reduce((s, p) => s + p.amountMinor, 0);
      if (sum !== amountMinor) {
        setExpenseError(`Amounts add up to ${formatMoney(sum, currency)}, not ${formatMoney(amountMinor, currency)}`);
        return;
      }
      payload = { ...base, splitMethod: "exact", participants: parts };
    } else if (splitMethod === "percentage") {
      const parts = participantIds.map((userId) => ({ userId, percentage: Number(participantValues[userId] || "0") }));
      const sum = parts.reduce((s, p) => s + p.percentage, 0);
      if (Math.round(sum * 100) !== 10000) {
        setExpenseError(`Percentages add up to ${sum}%, not 100%`);
        return;
      }
      payload = { ...base, splitMethod: "percentage", participants: parts };
    } else if (splitMethod === "shares") {
      const parts = participantIds.map((userId) => ({ userId, shares: Number(participantValues[userId] || "0") }));
      if (parts.some((p) => !(p.shares > 0))) {
        setExpenseError("Every participant needs a positive share count");
        return;
      }
      payload = { ...base, splitMethod: "shares", participants: parts };
    } else {
      const parts = participantIds.map((userId) => ({ userId, adjustmentMinor: toMinor(participantValues[userId] || "0") }));
      payload = { ...base, splitMethod: "adjustment", participants: parts };
    }

    try {
      await createExpense.mutateAsync(payload);
      setExpenseDescription("");
      setExpenseAmount("");
      setShowAddExpense(false);
    } catch (err) {
      setExpenseError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function handleSettle(e: FormEvent) {
    e.preventDefault();
    const amountMinor = Math.round(Number(settleAmount) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return;
    await createSettlement.mutateAsync({ fromUserId: settleFrom, toUserId: settleTo, amountMinor, currency, method: "other" });
    setSettleAmount("");
    setShowSettle(false);
  }

  async function handleLeave() {
    setLeaveError(null);
    try {
      await leaveGroup.mutateAsync();
      navigate("/");
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : "Something went wrong");
      setConfirmLeave(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteGroup.mutateAsync();
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Something went wrong");
      setConfirmDelete(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{group.name}</h1>
      </div>
      <p className="text-sm text-ink-muted mb-3">
        Balances in {currency}. Debts are {group.simplifyDebts ? "simplified" : "not simplified"}.
      </p>

      <div className="mb-6 flex items-center gap-4">
        {confirmLeave ? (
          <span className="text-sm text-ink-muted">
            Leave "{group.name}"?{" "}
            <button onClick={handleLeave} disabled={leaveGroup.isPending} className="text-rust font-medium hover:underline">
              {leaveGroup.isPending ? "Leaving…" : "Confirm"}
            </button>{" "}
            <button onClick={() => setConfirmLeave(false)} className="text-ink-muted hover:underline">
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmLeave(true)} className={linkButtonClass}>
            Leave group
          </button>
        )}

        {group.members.find((m) => m.userId === user?.id)?.role === "owner" &&
          (confirmDelete ? (
            <span className="text-sm text-ink-muted">
              Delete "{group.name}" for everyone?{" "}
              <button onClick={handleDelete} disabled={deleteGroup.isPending} className="text-rust font-medium hover:underline">
                {deleteGroup.isPending ? "Deleting…" : "Confirm"}
              </button>{" "}
              <button onClick={() => setConfirmDelete(false)} className="text-ink-muted hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className={linkButtonClass}>
              Delete group
            </button>
          ))}
      </div>
      {leaveError && <p className="text-sm text-rust mb-4">{leaveError}</p>}
      {deleteError && <p className="text-sm text-rust mb-4">{deleteError}</p>}

      <section className="mb-6 bg-white border border-line rounded-lg">
        <div className="flex items-center justify-between px-4 py-3.5">
          <h2 className="font-medium text-ink">Members</h2>
          <button onClick={() => setShowAddMember((v) => !v)} className={linkButtonClass}>
            {showAddMember ? "Cancel" : "Add member"}
          </button>
        </div>
        {showAddMember && (
          <form onSubmit={handleAddMember} className="mx-4 mb-4 flex gap-2">
            <input
              type="email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="email@example.com"
              required
              className={`flex-1 ${inputClass}`}
            />
            <button type="submit" disabled={addMember.isPending} className={primaryButtonClass}>
              {addMember.isPending ? "Adding…" : "Add"}
            </button>
          </form>
        )}
        {memberError && <p className="text-sm text-rust px-4 mb-3">{memberError}</p>}
        <div className="divide-y divide-line border-t border-line">
          {group.members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between text-sm px-4 py-3">
              <span className="flex items-center gap-2 text-ink">
                {m.color && <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_SWATCH_CLASS[m.color]}`} />}
                {nameFor(m)}
                {m.role === "owner" && <span className="text-xs text-gold font-medium">· Owner</span>}
              </span>
              <div className="flex items-center gap-3">
                {m.userId === user?.id && (
                  <select
                    value={m.color ?? ""}
                    onChange={(e) => setMemberColor.mutate((e.target.value || null) as MemberColor | null)}
                    className="rounded-md border border-line px-1.5 py-1 text-xs text-ink-muted focus:outline-none focus:ring-2 focus:ring-ledger/40"
                  >
                    <option value="">No color</option>
                    {memberColorValues.map((c) => (
                      <option key={c} value={c}>
                        {c[0]!.toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                )}
                <span className={`figure ${m.netBalanceMinor >= 0 ? "text-ledger" : "text-rust"}`}>
                  {m.netBalanceMinor === 0 ? "settled up" : formatMoney(m.netBalanceMinor, currency)}
                </span>
                {m.userId !== user?.id && (
                  <button onClick={() => removeMember.mutate(m.userId)} className="text-xs text-ink-muted hover:text-rust transition-colors">
                    remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6 bg-white border border-line rounded-lg">
        <div className="flex items-center justify-between px-4 py-3.5">
          <h2 className="font-medium text-ink">Expenses</h2>
          <div className="flex gap-4">
            <button onClick={() => setShowSettle((v) => !v)} className={linkButtonClass}>
              Settle up
            </button>
            <button
              onClick={() => {
                setShowAddExpense((v) => !v);
                setSplitMethod("equal");
                setParticipants(new Set(group.members.map((m) => m.userId)));
                setParticipantValues({});
                setPayerRows([{ userId: user?.id ?? "", amount: "" }]);
                setExpenseError(null);
              }}
              className={linkButtonClass}
            >
              Add expense
            </button>
          </div>
        </div>

        {showSettle && (
          <form onSubmit={handleSettle} className="mx-4 mb-4 bg-paper border border-line rounded-md p-3 space-y-2">
            <div className="flex gap-2">
              <select value={settleFrom} onChange={(e) => setSettleFrom(e.target.value)} required className={`flex-1 ${inputClass} py-1.5`}>
                <option value="">Who paid?</option>
                {group.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {nameFor(m)}
                  </option>
                ))}
              </select>
              <select value={settleTo} onChange={(e) => setSettleTo(e.target.value)} required className={`flex-1 ${inputClass} py-1.5`}>
                <option value="">Paid to whom?</option>
                {group.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {nameFor(m)}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)}
              placeholder={`Amount (${currency})`}
              required
              className={`${inputClass} py-1.5`}
            />
            <button type="submit" disabled={createSettlement.isPending} className={`${primaryButtonClass} py-1.5`}>
              {createSettlement.isPending ? "Recording…" : "Record settlement"}
            </button>
          </form>
        )}

        {showAddExpense && (
          <form onSubmit={handleAddExpense} className="mx-4 mb-4 bg-paper border border-line rounded-md p-3 space-y-3">
            <input
              value={expenseDescription}
              onChange={(e) => setExpenseDescription(e.target.value)}
              placeholder="Description"
              required
              className={`${inputClass} py-1.5`}
            />
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              placeholder={`Amount (${currency})`}
              required
              className={`${inputClass} py-1.5`}
            />
            <label className="block text-sm">
              <span className="text-ink font-medium">Paid by</span>
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className={`mt-1 ${inputClass} py-1.5`}>
                {group.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {nameFor(m)}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <span className="text-ink font-medium">Split</span>
              <div className="mt-1 flex gap-1.5">
                {(Object.keys(SPLIT_METHOD_LABELS) as SplitMethodChoice[]).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setSplitMethod(method)}
                    className={`rounded-md px-2.5 py-1 text-xs border transition-colors ${
                      splitMethod === method ? "bg-ledger text-paper border-ledger" : "border-line text-ink-muted hover:border-ledger"
                    }`}
                  >
                    {SPLIT_METHOD_LABELS[method]}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 space-y-1.5">
                {group.members.map((m) => (
                  <label key={m.userId} className="flex items-center gap-2 text-ink-muted">
                    <input type="checkbox" checked={participants.has(m.userId)} onChange={() => toggleParticipant(m.userId)} className="accent-ledger" />
                    <span className="flex-1">{nameFor(m)}</span>
                    {splitMethod !== "equal" && participants.has(m.userId) && (
                      <input
                        type="number"
                        step="0.01"
                        value={participantValues[m.userId] ?? ""}
                        onChange={(e) => setParticipantValues((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                        placeholder={splitMethod === "percentage" ? "%" : splitMethod === "shares" ? "shares" : splitMethod === "adjustment" ? "+/−" : "$"}
                        className="w-24 rounded-md border border-line px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40"
                      />
                    )}
                  </label>
                ))}
              </div>
              {(splitMethod === "exact" || splitMethod === "percentage") && (
                <p className="mt-1 text-xs figure text-ink-muted">
                  {splitMethod === "exact"
                    ? (() => {
                        const total = [...participants].reduce((s, id) => s + toMinor(participantValues[id] || "0"), 0);
                        const target = Math.round(Number(expenseAmount || "0") * 100);
                        return `${formatMoney(total, currency)} of ${formatMoney(target, currency)} assigned`;
                      })()
                    : (() => {
                        const total = [...participants].reduce((s, id) => s + Number(participantValues[id] || "0"), 0);
                        return `${total}% of 100% assigned`;
                      })()}
                </p>
              )}
            </div>
            {expenseError && <p className="text-sm text-rust">{expenseError}</p>}
            <button type="submit" disabled={createExpense.isPending} className={primaryButtonClass}>
              {createExpense.isPending ? "Adding…" : "Add expense"}
            </button>
          </form>
        )}

        {expensesQuery.data && expensesQuery.data.length === 0 && <p className="text-sm text-ink-muted px-4 pb-4">No expenses yet.</p>}
        {expensesQuery.data && expensesQuery.data.length > 0 && (
          <div className="divide-y divide-line border-t border-line">
            {expensesQuery.data.map((expense) => (
              <div key={expense.id} className="text-sm flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-ink">{expense.description}</p>
                  <p className="text-xs text-ink-muted">
                    {expense.payers.map((p) => nameFor(p)).join(", ")} paid · {formatDate(new Date(expense.expenseDate))}
                  </p>
                </div>
                <span className="figure text-ink font-medium">{formatMoney(expense.amountMinor, expense.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
