import { ActivityList } from "../components/ActivityList.js";
import { AppShell } from "../components/AppShell.js";
import { cardClass } from "../components/styles.js";
import { useActivity } from "../lib/hooks.js";

export function ActivityPage() {
  const activityQuery = useActivity();

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-ink mb-4">Activity</h1>
      {activityQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {activityQuery.isError && <p className="text-sm text-rust">Couldn't load activity.</p>}
      {activityQuery.data && (
        <div className={cardClass}>
          <ActivityList items={activityQuery.data} showGroup />
        </div>
      )}
    </AppShell>
  );
}
