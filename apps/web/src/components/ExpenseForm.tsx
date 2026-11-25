import { useState, type FormEvent } from "react";
import { formatMoney, formatMoneyInput, moneyInputStep, parseMoneyInput, type CreateExpenseRequest } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { draftToRequest, itemsTotalMinor, type ExpenseDraft, type SplitMethodChoice } from "../lib/expenseDraft.js";
import { useCategories } from "../lib/hooks.js";
import { personLabel, type Person } from "../lib/members.js";
import { ItemizedEditor } from "./ItemizedEditor.js";
import { inputClass, linkButtonClass, primaryButtonClass } from "./styles.js";

const SPLIT_METHOD_LABELS: Record<SplitMethodChoice, string> = {
  equal: "Equal",
  exact: "Exact",
  percentage: "%",
  shares: "Shares",
  adjustment: "+/−",
  itemized: "Items",
};

export function ExpenseForm(props: {
  people: Person[];
  currency: string;
  currentUserId: string | undefined;
  initial: ExpenseDraft;
  submitLabel: string;
  onSubmit: (request: CreateExpenseRequest) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { people, currency, currentUserId } = props;
  const [draft, setDraft] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const categoriesQuery = useCategories();
  const moneyStep = moneyInputStep(currency);

  const patch = (change: Partial<ExpenseDraft>) => setDraft((prev) => ({ ...prev, ...change }));
  // For running totals only: an incomplete field counts as zero.
  const toMinorOrZero = (value: string) => parseMoneyInput(value, currency) || 0;
  const itemized = draft.splitMethod === "itemized";
  const target = itemized ? itemsTotalMinor(draft, currency) : toMinorOrZero(draft.amount);
  const payersTotal = draft.payerRows.reduce((s, r) => s + toMinorOrZero(r.amount), 0);

  function patchPayer(index: number, change: Partial<{ userId: string; amount: string }>) {
    patch({ payerRows: draft.payerRows.map((row, i) => (i === index ? { ...row, ...change } : row)) });
  }
  function addPayer() {
    const used = new Set(draft.payerRows.map((r) => r.userId));
    const next = people.find((p) => !used.has(p.userId));
    if (next) patch({ payerRows: [...draft.payerRows, { userId: next.userId, amount: "" }] });
  }
  function toggleParticipant(userId: string) {
    const participants = new Set(draft.participants);
    if (!participants.delete(userId)) participants.add(userId);
    patch({ participants });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = draftToRequest(draft, currency);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSubmitting(true);
    try {
      await props.onSubmit(result.request);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const personOptions = people.map((p) => (
    <option key={p.userId} value={p.userId}>
      {personLabel(p, currentUserId)}
    </option>
  ));
  const addPayerButton = draft.payerRows.length < people.length && (
    <button type="button" onClick={addPayer} className={`mt-1 block ${linkButtonClass}`}>
      + add another payer
    </button>
  );
  const categories = categoriesQuery.data ?? [];
  const topLevel = categories.filter((c) => c.parentId === null);

  return (
    <form onSubmit={handleSubmit} className="bg-paper border border-line rounded-md p-3 space-y-3">
      <input
        value={draft.description}
        onChange={(e) => patch({ description: e.target.value })}
        placeholder="Description"
        maxLength={200}
        required
        className={`${inputClass} py-1.5`}
      />
      <div className="flex gap-2">
        <input
          type="number"
          step={moneyStep}
          min={moneyStep}
          value={itemized ? (target ? formatMoneyInput(target, currency) : "") : draft.amount}
          readOnly={itemized}
          onChange={(e) => patch({ amount: e.target.value })}
          placeholder={`Amount (${currency})`}
          required={!itemized}
          className={`${inputClass} py-1.5`}
        />
        <input
          type="date"
          aria-label="Date"
          value={draft.expenseDate}
          onChange={(e) => patch({ expenseDate: e.target.value })}
          required
          className={`${inputClass} py-1.5`}
        />
      </div>
      <select
        aria-label="Category"
        value={draft.categoryId}
        onChange={(e) => patch({ categoryId: e.target.value })}
        className={`${inputClass} py-1.5`}
      >
        <option value="">No category</option>
        {topLevel.map((top) => [
          <option key={top.id} value={top.id}>
            {top.name}
          </option>,
          ...categories
            .filter((c) => c.parentId === top.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {`   ${c.name}`}
              </option>
            )),
        ])}
      </select>
      <div className="text-sm">
        <span className="text-ink font-medium">Paid by</span>
        {draft.payerRows.length === 1 ? (
          <>
            <select
              aria-label="Paid by"
              value={draft.payerRows[0]!.userId}
              onChange={(e) => patchPayer(0, { userId: e.target.value })}
              className={`mt-1 ${inputClass} py-1.5`}
            >
              {personOptions}
            </select>
            {addPayerButton}
          </>
        ) : (
          <div className="mt-1 space-y-1.5">
            {draft.payerRows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <select value={row.userId} onChange={(e) => patchPayer(i, { userId: e.target.value })} className={`flex-1 ${inputClass} py-1.5`}>
                  {personOptions}
                </select>
                <input
                  type="number"
                  step={moneyStep}
                  min="0"
                  value={row.amount}
                  onChange={(e) => patchPayer(i, { amount: e.target.value })}
                  placeholder="Amount"
                  className={`w-28 ${inputClass} py-1.5`}
                />
                <button
                  type="button"
                  onClick={() => patch({ payerRows: draft.payerRows.filter((_, j) => j !== i) })}
                  className="text-xs text-ink-muted hover:text-rust transition-colors"
                >
                  remove
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              {addPayerButton || <span />}
              <span className={`figure ${payersTotal === target ? "text-ledger" : "text-rust"}`}>
                {formatMoney(payersTotal, currency)} of {formatMoney(target, currency)} assigned
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="text-sm">
        <span className="text-ink font-medium">Split</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(Object.keys(SPLIT_METHOD_LABELS) as SplitMethodChoice[]).map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => patch({ splitMethod: method })}
              className={`rounded-md px-2.5 py-1 text-xs border transition-colors ${
                draft.splitMethod === method ? "bg-ledger text-paper border-ledger" : "border-line text-ink-muted hover:border-ledger"
              }`}
            >
              {SPLIT_METHOD_LABELS[method]}
            </button>
          ))}
        </div>
        {itemized && (
          <ItemizedEditor
            people={people}
            currency={currency}
            currentUserId={currentUserId}
            value={draft}
            onChange={({ items, tax, tip }) => patch({ items, tax, tip })}
          />
        )}
        <div className="mt-1.5 space-y-1.5">
          {!itemized && people.map((p) => (
            <label key={p.userId} className="flex items-center gap-2 text-ink-muted">
              <input
                type="checkbox"
                checked={draft.participants.has(p.userId)}
                onChange={() => toggleParticipant(p.userId)}
                className="accent-ledger"
              />
              <span className="flex-1">{personLabel(p, currentUserId)}</span>
              {draft.splitMethod !== "equal" && draft.participants.has(p.userId) && (
                <input
                  type="number"
                  step={draft.splitMethod === "exact" || draft.splitMethod === "adjustment" ? moneyStep : "0.01"}
                  value={draft.participantValues[p.userId] ?? ""}
                  onChange={(e) => patch({ participantValues: { ...draft.participantValues, [p.userId]: e.target.value } })}
                  placeholder={
                    draft.splitMethod === "percentage" ? "%" : draft.splitMethod === "shares" ? "shares" : draft.splitMethod === "adjustment" ? "+/−" : currency
                  }
                  className="w-24 rounded-md border border-line px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40"
                />
              )}
            </label>
          ))}
        </div>
        {draft.splitMethod === "exact" && (
          <p className="mt-1 text-xs figure text-ink-muted">
            {formatMoney(
              [...draft.participants].reduce((s, id) => s + toMinorOrZero(draft.participantValues[id] ?? ""), 0),
              currency,
            )}{" "}
            of {formatMoney(target, currency)} assigned
          </p>
        )}
        {draft.splitMethod === "percentage" && (
          <p className="mt-1 text-xs figure text-ink-muted">
            {[...draft.participants].reduce((s, id) => s + Math.round(Number(draft.participantValues[id] || "0") * 100), 0) / 100}% of 100% assigned
          </p>
        )}
      </div>
      <textarea
        value={draft.notes}
        onChange={(e) => patch({ notes: e.target.value })}
        placeholder="Notes (optional)"
        maxLength={2000}
        rows={2}
        className={`${inputClass} py-1.5`}
      />
      {error && <p className="text-sm text-rust">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? "Saving…" : props.submitLabel}
        </button>
        <button type="button" onClick={props.onCancel} className={linkButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
