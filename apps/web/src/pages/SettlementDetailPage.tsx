import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  formatMoneyInput,
  moneyInputStep,
  parseMoneyInput,
  type Settlement,
  type SettlementHistoryEntry,
  type SettlementSnapshot,
} from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { cardClass, inputClass, linkButtonClass, primaryButtonClass } from "../components/styles.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useGroup, useSetSettlementDeleted, useSettlement, useSettlementHistory, useUpdateSettlement } from "../lib/hooks.js";
import { METHOD_LABELS, type SettlementMethod } from "../lib/settlements.js";

const CHANGE_LABELS: Record<SettlementHistoryEntry["changeType"], string> = {
  create: "recorded this payment",
  update: "edited this payment",
  delete: "deleted this payment",
  restore: "restored this payment",
};

function changesBetween(before: SettlementSnapshot, after: SettlementSnapshot, currency: string): string[] {
  const fields: [string, string, string][] = [
    ["Amount", formatMoney(before.amountMinor, currency), formatMoney(after.amountMinor, currency)],
    ["Date", formatCalendarDate(before.settledAt), formatCalendarDate(after.settledAt)],
    ["Method", METHOD_LABELS[before.method], METHOD_LABELS[after.method]],
    ["Note", before.note ?? "none", after.note ?? "none"],
  ];
  return fields.filter(([, from, to]) => from !== to).map(([label, from, to]) => `${label}: ${from} → ${to}`);
}

export function SettlementDetailPage() {
  const { settlementId } = useParams<{ settlementId: string }>();
  const query = useSettlement(settlementId!);

  if (query.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-muted">Loading…</p>
      </AppShell>
    );
  }
  if (!query.data) {
    return (
      <AppShell>
        <p className="text-sm text-rust">Payment not found, or you don't have access to it.</p>
      </AppShell>
    );
  }
  return <SettlementDetail key={settlementId} settlement={query.data} />;
}

function SettlementDetail({ settlement }: { settlement: Settlement }) {
  const { user } = useAuth();
  const groupQuery = useGroup(settlement.groupId);
  const historyQuery = useSettlementHistory(settlement.id);
  const setDeleted = useSetSettlementDeleted(settlement.id);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otherId = settlement.fromUserId === user?.id ? settlement.toUserId : settlement.fromUserId;

  async function changeDeleted(deleted: boolean) {
    setError(null);
    setConfirmDelete(false);
    try {
      await setDeleted.mutateAsync({ version: settlement.version, deleted });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <AppShell>
      <Link to={settlement.groupId ? `/groups/${settlement.groupId}` : `/people/${otherId}`} className={linkButtonClass}>
        ← {settlement.groupId ? (groupQuery.data?.name ?? "Group") : "Back"}
      </Link>
      <section className={`mt-3 p-4 ${cardClass}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-ink">
              {settlement.fromUserId === user?.id ? "You" : settlement.fromDisplayName} paid{" "}
              {settlement.toUserId === user?.id ? "you" : settlement.toDisplayName}
            </h1>
            <p className="text-sm text-ink-muted">
              {formatCalendarDate(settlement.settledAt)} · {METHOD_LABELS[settlement.method]}
            </p>
          </div>
          <span className={`figure text-2xl font-semibold ${settlement.deletedAt ? "text-ink-muted line-through" : "text-ink"}`}>
            {formatMoney(settlement.amountMinor, settlement.currency)}
          </span>
        </div>
        {settlement.deletedAt && <p className="mt-2 text-sm text-rust">Deleted. It doesn't count toward anyone's balance.</p>}
        {settlement.note && <p className="mt-3 text-sm text-ink whitespace-pre-wrap">{settlement.note}</p>}
        {error && <p className="mt-3 text-sm text-rust">{error}</p>}
        {editing ? (
          <EditForm key={editing.version} settlement={editing} onReload={() => setEditing(settlement)} onDone={() => setEditing(null)} />
        ) : (
          <div className="mt-4 flex items-center gap-4">
            {settlement.deletedAt ? (
              <button onClick={() => changeDeleted(false)} disabled={setDeleted.isPending} className={linkButtonClass}>
                Restore
              </button>
            ) : confirmDelete ? (
              <span className="text-sm text-ink-muted">
                Delete this payment?{" "}
                <button onClick={() => changeDeleted(true)} className="text-rust font-medium hover:underline">
                  Confirm
                </button>{" "}
                <button onClick={() => setConfirmDelete(false)} className="hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <button onClick={() => setEditing(settlement)} className={linkButtonClass}>
                  Edit
                </button>
                <button onClick={() => setConfirmDelete(true)} className={linkButtonClass}>
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </section>

      {historyQuery.data && historyQuery.data.length > 0 && (
        <section className={`mt-6 ${cardClass}`}>
          <h2 className="font-medium text-ink px-4 py-3.5 border-b border-line">History</h2>
          <ul className="divide-y divide-line">
            {historyQuery.data.map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-sm text-ink">
                {entry.editedBy === user?.id ? "You" : entry.editedByName} {CHANGE_LABELS[entry.changeType]}
                <p className="text-xs text-ink-muted">{formatDateTime(new Date(entry.editedAt))}</p>
                {entry.changeType === "update" && entry.before && entry.after && (
                  <ul className="mt-1 text-xs text-ink-muted">
                    {changesBetween(entry.before, entry.after, settlement.currency).map((change) => (
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

function EditForm({ settlement, onReload, onDone }: { settlement: Settlement; onReload: () => void; onDone: () => void }) {
  const update = useUpdateSettlement(settlement.id);
  const [amount, setAmount] = useState(formatMoneyInput(settlement.amountMinor, settlement.currency));
  const [date, setDate] = useState(settlement.settledAt);
  const [method, setMethod] = useState<SettlementMethod>(settlement.method);
  const [note, setNote] = useState(settlement.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const moneyStep = moneyInputStep(settlement.currency);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountMinor = parseMoneyInput(amount, settlement.currency);
    if (!(amountMinor > 0)) {
      setError("Enter a valid amount");
      return;
    }
    try {
      await update.mutateAsync({ version: settlement.version, amountMinor, method, settledAt: date, ...(note.trim() ? { note } : {}) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "version_conflict") setConflict(true);
      else setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 bg-paper border border-line rounded-md p-3 space-y-2">
      {conflict && (
        <p className="text-sm text-rust">
          Someone else changed this payment while you were editing, so your changes weren't saved.{" "}
          <button type="button" onClick={onReload} className="font-medium underline">
            Discard mine and load theirs
          </button>
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="number"
          aria-label="Amount"
          step={moneyStep}
          min={moneyStep}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={`${inputClass} py-1.5`}
        />
        <input type="date" aria-label="Date paid" value={date} onChange={(e) => setDate(e.target.value)} required className={`${inputClass} py-1.5`} />
      </div>
      <select aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as SettlementMethod)} className={`${inputClass} py-1.5`}>
        {Object.entries(METHOD_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={500} className={`${inputClass} py-1.5`} />
      {error && <p className="text-sm text-rust">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={update.isPending} className={primaryButtonClass}>
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onDone} className={linkButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
