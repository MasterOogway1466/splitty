import { Link } from "react-router-dom";
import { formatDateTime, type ActivityItem } from "@splitty/shared";
import { useAuth } from "../lib/AuthContext.js";

const VERBS: Record<ActivityItem["type"], string> = {
  expense_created: "added",
  expense_updated: "edited",
  expense_deleted: "deleted",
  expense_restored: "restored",
  comment_added: "commented on",
  settlement_created: "recorded a payment of",
  settlement_updated: "edited a payment of",
  settlement_deleted: "deleted a payment of",
  settlement_restored: "restored a payment of",
};

export function ActivityList({ items, showGroup }: { items: ActivityItem[]; showGroup: boolean }) {
  const { user } = useAuth();
  if (items.length === 0) return <p className="text-sm text-ink-muted px-4 py-4">Nothing here yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className="px-4 py-3 text-sm text-ink">
          {item.actorId === user?.id ? "You" : item.actorDisplayName} {VERBS[item.type]}{" "}
          {item.entityLabel !== null ? (
            <Link
              to={`/${item.entityType === "expense" ? "expenses" : "settlements"}/${item.entityId}`}
              className="font-medium hover:text-ledger transition-colors"
            >
              {item.entityLabel}
            </Link>
          ) : item.entityType === "expense" ? (
            "an expense"
          ) : (
            "an unknown amount"
          )}
          <p className="text-xs text-ink-muted">
            {showGroup && item.groupName && `${item.groupName} · `}
            {formatDateTime(new Date(item.createdAt))}
          </p>
        </li>
      ))}
    </ul>
  );
}
