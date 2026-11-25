import { useParams } from "react-router-dom";
import { ActivityList } from "../components/ActivityList.js";
import { AppShell } from "../components/AppShell.js";
import { ExpensesSection } from "../components/ExpensesSection.js";
import { GroupActions } from "../components/GroupActions.js";
import { MembersSection } from "../components/MembersSection.js";
import { LoadMore } from "../components/LoadMore.js";
import { SettlementsSection } from "../components/SettlementsSection.js";
import { cardClass } from "../components/styles.js";
import { useActivity, useGroup } from "../lib/hooks.js";

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const groupQuery = useGroup(groupId!);
  const activityQuery = useActivity(groupId!);

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

  return (
    <AppShell>
      <h1 className="text-xl font-semibold text-ink mb-1">{group.name}</h1>
      <p className="text-sm text-ink-muted mb-3">
        Balances in {group.defaultCurrency}. Debts are {group.simplifyDebts ? "simplified" : "not simplified"}.
      </p>
      <GroupActions group={group} />
      <MembersSection group={group} />
      <ExpensesSection key={group.id} group={group} />
      <SettlementsSection key={`payments-${group.id}`} scope={{ groupId: group.id }} />
      {activityQuery.data && (
        <section className={cardClass}>
          <h2 className="font-medium text-ink px-4 py-3.5 border-b border-line">Activity</h2>
          <ActivityList items={activityQuery.data.pages.flatMap((p) => p.items)} showGroup={false} />
          <LoadMore query={activityQuery} />
        </section>
      )}
    </AppShell>
  );
}
