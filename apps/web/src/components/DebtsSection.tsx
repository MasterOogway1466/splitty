import { useState } from "react";
import { formatMoney, type GroupDetail } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";
import { useGroupDebts } from "../lib/hooks.js";
import { personLabel } from "../lib/members.js";
import { cardClass } from "./styles.js";

export function DebtsSection({ group }: { group: GroupDetail }) {
  const { user } = useAuth();
  const query = useGroupDebts(group.id);
  const [showRecorded, setShowRecorded] = useState(false);
  if (!query.data || query.data.recordedDebts.length === 0) return null;

  const { simplified, debts, recordedDebts } = query.data;
  const shown = showRecorded ? recordedDebts : debts;
  const nameOf = (id: string) => {
    const member = group.members.find((m) => m.userId === id);
    return member ? personLabel(member, user?.id) : "Someone";
  };

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="font-medium text-ink px-4 py-3.5">Who pays whom</h2>
      <ul className="divide-y divide-line border-t border-line">
        {shown.map((d) => (
          <li key={`${d.fromUserId}:${d.toUserId}`} className="flex items-center justify-between px-4 py-3 text-sm text-ink">
            <span>
              {nameOf(d.fromUserId)} → {nameOf(d.toUserId)}
            </span>
            <span className="figure font-medium">{formatMoney(d.amountMinor, group.defaultCurrency)}</span>
          </li>
        ))}
        {shown.length === 0 && <li className="px-4 py-3 text-sm text-ink-muted">Nothing to pay: these debts cancel out.</li>}
      </ul>
      {simplified && (
        <div className="px-4 py-3 border-t border-line">
          <button onClick={() => setShowRecorded((v) => !v)} className="text-xs text-ink-muted hover:text-ledger transition-colors">
            {showRecorded ? "Show simplified" : "Show the debts behind this"}
          </button>
        </div>
      )}
    </section>
  );
}
