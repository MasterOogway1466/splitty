import { useState } from "react";
import { formatCalendarDate, formatMoney } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";
import { useSettlements, type ListScope } from "../lib/hooks.js";
import { METHOD_LABELS } from "../lib/settlements.js";
import { DisclosureButton, RowChevron, RowLink, rowClass } from "./Button.js";
import { LoadMore } from "./LoadMore.js";
import { cardClass } from "./styles.js";

export function SettlementsSection({ scope }: { scope: ListScope }) {
  const { user } = useAuth();
  const [showDeleted, setShowDeleted] = useState(false);
  const query = useSettlements(scope, showDeleted);
  const settlements = query.data?.pages.flatMap((p) => p.items) ?? [];
  const name = (id: string, displayName: string) => (id === user?.id ? "You" : displayName);

  return (
    <section className={`mb-6 ${cardClass}`}>
      <h2 className="font-medium text-ink px-4 py-3.5">{showDeleted ? "Deleted payments" : "Payments"}</h2>
      {query.data && settlements.length === 0 && (
        <p className="text-sm text-ink-muted px-4 pb-4">{showDeleted ? "Nothing deleted." : "No payments yet."}</p>
      )}
      {settlements.length > 0 && (
        <div className="divide-y divide-line border-t border-line">
          {settlements.map((s) => (
            <div key={s.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${rowClass}`}>
              <div className="min-w-0 flex-1">
                <RowLink to={`/settlements/${s.id}`}>
                  {name(s.fromUserId, s.fromDisplayName)} paid {s.toUserId === user?.id ? "you" : s.toDisplayName}
                </RowLink>
                <p className="text-xs text-ink-muted">
                  {formatCalendarDate(s.settledAt)} · {METHOD_LABELS[s.method]}
                </p>
              </div>
              <span className={`figure font-medium ${showDeleted ? "text-ink-muted line-through" : "text-ink"}`}>
                {formatMoney(s.amountMinor, s.currency)}
              </span>
              <RowChevron />
            </div>
          ))}
        </div>
      )}
      <LoadMore query={query} />
      <div className="border-t border-line">
        <DisclosureButton open={showDeleted} onClick={() => setShowDeleted((v) => !v)}>
          {showDeleted ? "Back to payments" : "Show deleted"}
        </DisclosureButton>
      </div>
    </section>
  );
}
