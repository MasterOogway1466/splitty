import { useState, type FormEvent } from "react";
import {
  formatMoney,
  formatMoneyInput,
  moneyInputStep,
  parseMoneyInput,
  todayCalendarDate,
  type CreateSettlementRequest,
  type GroupDebt,
} from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { personLabel, type Person } from "../lib/members.js";
import { METHOD_LABELS, type SettlementMethod } from "../lib/settlements.js";
import { inputClass, linkButtonClass, primaryButtonClass } from "./styles.js";

export function SettleForm(props: {
  people: Person[];
  currency: string;
  currentUserId: string | undefined;
  /** Payments that would clear what is outstanding; picking one fills the form. */
  suggestions: GroupDebt[];
  onSubmit: (request: CreateSettlementRequest) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { people, currency, currentUserId, suggestions } = props;
  const mine = suggestions.find((s) => s.fromUserId === currentUserId) ?? suggestions.find((s) => s.toUserId === currentUserId);
  const [from, setFrom] = useState(mine?.fromUserId ?? "");
  const [to, setTo] = useState(mine?.toUserId ?? "");
  const [amount, setAmount] = useState(mine ? formatMoneyInput(mine.amountMinor, currency) : "");
  const [date, setDate] = useState(todayCalendarDate());
  const [method, setMethod] = useState<SettlementMethod>("other");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const moneyStep = moneyInputStep(currency);

  const nameOf = (userId: string) => {
    const person = people.find((p) => p.userId === userId);
    return person ? personLabel(person, currentUserId) : "Someone";
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountMinor = parseMoneyInput(amount, currency);
    if (!(amountMinor > 0)) {
      setError("Enter a valid amount");
      return;
    }
    if (from === to) {
      setError("Pick two different people");
      return;
    }
    setSubmitting(true);
    try {
      await props.onSubmit({
        fromUserId: from,
        toUserId: to,
        amountMinor,
        currency,
        method,
        settledAt: date,
        ...(note.trim() ? { note } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const options = people.map((p) => (
    <option key={p.userId} value={p.userId}>
      {personLabel(p, currentUserId)}
    </option>
  ));

  return (
    <form onSubmit={handleSubmit} className="bg-paper border border-line rounded-md p-3 space-y-2">
      {suggestions.length > 0 && (
        <div className="text-sm">
          <span className="text-ink font-medium">Outstanding</span>
          <ul className="mt-1 space-y-1">
            {suggestions.map((s) => (
              <li key={`${s.fromUserId}:${s.toUserId}`}>
                <button
                  type="button"
                  onClick={() => {
                    setFrom(s.fromUserId);
                    setTo(s.toUserId);
                    setAmount(formatMoneyInput(s.amountMinor, currency));
                  }}
                  className={`text-left ${linkButtonClass}`}
                >
                  {nameOf(s.fromUserId)} → {nameOf(s.toUserId)} <span className="figure">{formatMoney(s.amountMinor, currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <select aria-label="Who paid" value={from} onChange={(e) => setFrom(e.target.value)} required className={`flex-1 ${inputClass} py-1.5`}>
          <option value="">Who paid?</option>
          {options}
        </select>
        <select aria-label="Paid to" value={to} onChange={(e) => setTo(e.target.value)} required className={`flex-1 ${inputClass} py-1.5`}>
          <option value="">Paid to whom?</option>
          {options}
        </select>
      </div>
      <div className="flex gap-2">
        <input
          type="number"
          step={moneyStep}
          min={moneyStep}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount (${currency})`}
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
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? "Recording…" : "Record payment"}
        </button>
        <button type="button" onClick={props.onCancel} className={linkButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
