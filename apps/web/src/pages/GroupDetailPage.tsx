import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatDate, formatMoney, memberColorValues, type MemberColor } from "@splitty/shared";
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

const COLOR_SWATCH_CLASS: Record<MemberColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  slate: "bg-slate-500",
};

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
  const [paidBy, setPaidBy] = useState(user?.id ?? "");
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
        <p className="text-sm text-slate-500">Loading…</p>
      </AppShell>
    );
  }
  if (groupQuery.isError || !groupQuery.data) {
    return (
      <AppShell>
        <p className="text-sm text-red-700">Group not found, or you don't have access to it.</p>
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
    try {
      await createExpense.mutateAsync({
        description: expenseDescription,
        amountMinor,
        currency,
        paidBy,
        participantUserIds: [...participants],
      });
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
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{group.name}</h1>
        <p className="text-sm text-slate-500">{currency} · simplify debts: {group.simplifyDebts ? "on" : "off"}</p>
      </div>

      <div className="mb-6 flex items-center gap-4">
        {confirmLeave ? (
          <span className="text-sm text-slate-600">
            Leave "{group.name}"?{" "}
            <button onClick={handleLeave} disabled={leaveGroup.isPending} className="text-red-700 font-medium hover:underline">
              {leaveGroup.isPending ? "Leaving…" : "Confirm"}
            </button>{" "}
            <button onClick={() => setConfirmLeave(false)} className="text-slate-500 hover:underline">
              Cancel
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmLeave(true)} className="text-sm text-slate-500 hover:text-red-700 underline">
            Leave group
          </button>
        )}

        {group.members.find((m) => m.userId === user?.id)?.role === "owner" &&
          (confirmDelete ? (
            <span className="text-sm text-slate-600">
              Delete "{group.name}" for everyone?{" "}
              <button onClick={handleDelete} disabled={deleteGroup.isPending} className="text-red-700 font-medium hover:underline">
                {deleteGroup.isPending ? "Deleting…" : "Confirm"}
              </button>{" "}
              <button onClick={() => setConfirmDelete(false)} className="text-slate-500 hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-sm text-slate-500 hover:text-red-700 underline">
              Delete group
            </button>
          ))}
      </div>
      {leaveError && <p className="text-sm text-red-700 mb-4">{leaveError}</p>}
      {deleteError && <p className="text-sm text-red-700 mb-4">{deleteError}</p>}

      <section className="mb-6 bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-slate-900">Members</h2>
          <button onClick={() => setShowAddMember((v) => !v)} className="text-sm text-slate-600 hover:text-slate-900 underline">
            {showAddMember ? "Cancel" : "Add member"}
          </button>
        </div>
        {showAddMember && (
          <form onSubmit={handleAddMember} className="mb-4 flex gap-2">
            <input
              type="email"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="email@example.com"
              required
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button type="submit" disabled={addMember.isPending} className="rounded-md bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-700">
              {addMember.isPending ? "Adding…" : "Add"}
            </button>
          </form>
        )}
        {memberError && <p className="text-sm text-red-700 mb-2">{memberError}</p>}
        <ul className="space-y-2">
          {group.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-900">
                {m.color && <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_SWATCH_CLASS[m.color]}`} />}
                {nameFor(m)}
                {m.role === "owner" && <span className="text-xs text-amber-700">· Owner</span>}
              </span>
              <div className="flex items-center gap-3">
                {m.userId === user?.id && (
                  <select
                    value={m.color ?? ""}
                    onChange={(e) => setMemberColor.mutate((e.target.value || null) as MemberColor | null)}
                    className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                  >
                    <option value="">No color</option>
                    {memberColorValues.map((c) => (
                      <option key={c} value={c}>
                        {c[0]!.toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                )}
                <span className={m.netBalanceMinor >= 0 ? "text-green-700" : "text-red-700"}>
                  {m.netBalanceMinor === 0 ? "settled up" : formatMoney(m.netBalanceMinor, currency)}
                </span>
                {m.userId !== user?.id && (
                  <button onClick={() => removeMember.mutate(m.userId)} className="text-xs text-slate-400 hover:text-red-600">
                    remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6 bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-slate-900">Expenses</h2>
          <div className="flex gap-3">
            <button onClick={() => setShowSettle((v) => !v)} className="text-sm text-slate-600 hover:text-slate-900 underline">
              Settle up
            </button>
            <button
              onClick={() => {
                setShowAddExpense((v) => !v);
                setParticipants(new Set(group.members.map((m) => m.userId)));
                setPaidBy(user?.id ?? "");
              }}
              className="text-sm text-slate-600 hover:text-slate-900 underline"
            >
              Add expense
            </button>
          </div>
        </div>

        {showSettle && (
          <form onSubmit={handleSettle} className="mb-4 border border-slate-200 rounded-md p-3 space-y-2">
            <div className="flex gap-2">
              <select value={settleFrom} onChange={(e) => setSettleFrom(e.target.value)} required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">Who paid?</option>
                {group.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {nameFor(m)}
                  </option>
                ))}
              </select>
              <select value={settleTo} onChange={(e) => setSettleTo(e.target.value)} required className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm">
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
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button type="submit" disabled={createSettlement.isPending} className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 hover:bg-slate-700">
              {createSettlement.isPending ? "Recording…" : "Record settlement"}
            </button>
          </form>
        )}

        {showAddExpense && (
          <form onSubmit={handleAddExpense} className="mb-4 border border-slate-200 rounded-md p-3 space-y-2">
            <input
              value={expenseDescription}
              onChange={(e) => setExpenseDescription(e.target.value)}
              placeholder="Description"
              required
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              placeholder={`Amount (${currency})`}
              required
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <label className="block text-sm">
              <span className="text-slate-700">Paid by</span>
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {group.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {nameFor(m)}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <span className="text-slate-700">Split equally between</span>
              <div className="mt-1 space-y-1">
                {group.members.map((m) => (
                  <label key={m.userId} className="flex items-center gap-2">
                    <input type="checkbox" checked={participants.has(m.userId)} onChange={() => toggleParticipant(m.userId)} />
                    {nameFor(m)}
                  </label>
                ))}
              </div>
            </div>
            {expenseError && <p className="text-sm text-red-700">{expenseError}</p>}
            <button type="submit" disabled={createExpense.isPending} className="rounded-md bg-slate-900 text-white text-sm px-3 py-1.5 hover:bg-slate-700">
              {createExpense.isPending ? "Adding…" : "Add expense"}
            </button>
          </form>
        )}

        {expensesQuery.data && expensesQuery.data.length === 0 && <p className="text-sm text-slate-500">No expenses yet.</p>}
        <ul className="space-y-2">
          {expensesQuery.data?.map((expense) => (
            <li key={expense.id} className="text-sm flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
              <div>
                <p className="text-slate-900">{expense.description}</p>
                <p className="text-xs text-slate-500">
                  {expense.payers.map((p) => nameFor(p)).join(", ")} paid · {formatDate(new Date(expense.expenseDate))}
                </p>
              </div>
              <span className="text-slate-900 font-medium">{formatMoney(expense.amountMinor, expense.currency)}</span>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
