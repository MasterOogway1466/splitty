import { useState, type FormEvent } from "react";
import { moneyInputStep, parseMoneyInput, type GroupDetail } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useCreateGroupSettlement } from "../lib/hooks.js";
import { personLabel } from "../lib/members.js";
import { inputClass, primaryButtonClass } from "./styles.js";

export function SettleForm({ group, onDone }: { group: GroupDetail; onDone: () => void }) {
  const { user } = useAuth();
  const createSettlement = useCreateGroupSettlement(group.id);
  const currency = group.defaultCurrency;
  const moneyStep = moneyInputStep(currency);
  const [settleFrom, setSettleFrom] = useState("");
  const [settleTo, setSettleTo] = useState("");
  const [settleAmount, setSettleAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSettle(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountMinor = parseMoneyInput(settleAmount, currency);
    if (!(amountMinor > 0)) {
      setError("Enter a valid amount");
      return;
    }
    try {
      await createSettlement.mutateAsync({ fromUserId: settleFrom, toUserId: settleTo, amountMinor, currency, method: "other" });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSettle} className="bg-paper border border-line rounded-md p-3 space-y-2">
      <div className="flex gap-2">
        <select value={settleFrom} onChange={(e) => setSettleFrom(e.target.value)} required className={`flex-1 ${inputClass} py-1.5`}>
          <option value="">Who paid?</option>
          {group.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {personLabel(m, user?.id)}
            </option>
          ))}
        </select>
        <select value={settleTo} onChange={(e) => setSettleTo(e.target.value)} required className={`flex-1 ${inputClass} py-1.5`}>
          <option value="">Paid to whom?</option>
          {group.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {personLabel(m, user?.id)}
            </option>
          ))}
        </select>
      </div>
      <input
        type="number"
        step={moneyStep}
        min={moneyStep}
        value={settleAmount}
        onChange={(e) => setSettleAmount(e.target.value)}
        placeholder={`Amount (${currency})`}
        required
        className={`${inputClass} py-1.5`}
      />
      {error && <p className="text-sm text-rust">{error}</p>}
      <button type="submit" disabled={createSettlement.isPending} className={`${primaryButtonClass} py-1.5`}>
        {createSettlement.isPending ? "Recording…" : "Record settlement"}
      </button>
    </form>
  );
}
