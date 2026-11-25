import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CURRENCY_CODES, formatMoney, type GroupSummary } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { Button, DisclosureButton, RowChevron, RowLink, rowClass } from "../components/Button.js";
import { cardClass, focusRing } from "../components/styles.js";
import { useCreateGroup, useGlobalBalance, useGroupAction, useGroups } from "../lib/hooks.js";

export function HomePage() {
  const groupsQuery = useGroups();
  const balanceQuery = useGlobalBalance();
  const createGroup = useCreateGroup();
  const archivedQuery = useGroups("archived");
  const deletedQuery = useGroups("deleted");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    await createGroup.mutateAsync({ name, groupType: "other", defaultCurrency: currency });
    setName("");
    setShowForm(false);
  }

  const balances = (balanceQuery.data ?? []).filter((b) => b.netMinor !== 0);

  return (
    <AppShell>
      <section className="mb-10">
        {balanceQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
        {balanceQuery.data && balances.length === 0 && <p className="text-lg text-ink-muted">You're all settled up.</p>}
        {balances.length === 1 && (
          <div>
            <p className="text-sm text-ink-muted mb-1">{balances[0]!.netMinor >= 0 ? "You're owed" : "You owe"}</p>
            <p className={`figure text-5xl font-semibold ${balances[0]!.netMinor >= 0 ? "text-ledger" : "text-rust"}`}>
              {formatMoney(Math.abs(balances[0]!.netMinor), balances[0]!.currency)}
            </p>
          </div>
        )}
        {balances.length > 1 && (
          <div>
            <p className="text-sm text-ink-muted mb-2">Your balance, by currency</p>
            <ul className="space-y-1">
              {balances.map((b) => (
                <li key={b.currency} className={`figure text-2xl font-semibold ${b.netMinor >= 0 ? "text-ledger" : "text-rust"}`}>
                  {formatMoney(Math.abs(b.netMinor), b.currency)}
                  <span className="font-sans text-sm font-normal text-ink-muted ml-2">{b.netMinor >= 0 ? "owed to you" : "you owe"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-ink">Groups</h2>
          <Button variant={showForm ? "secondary" : "primary"} icon={showForm ? "close" : "plus"} aria-expanded={showForm} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "New group"}
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mb-4 bg-white border border-line rounded-lg p-4 space-y-3">
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Group name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-md border border-edge bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Default currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                required
                className="w-32 rounded-md border border-edge bg-white px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
              >
                {CURRENCY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary" size="md" disabled={createGroup.isPending}>
              {createGroup.isPending ? "Creating…" : "Create group"}
            </Button>
          </form>
        )}

        {groupsQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
        {groupsQuery.data && groupsQuery.data.length === 0 && (
          <p className="text-sm text-ink-muted">No groups yet — create one to start splitting expenses.</p>
        )}
        {groupsQuery.data && groupsQuery.data.length > 0 && (
          <div className="overflow-hidden bg-white border border-line rounded-lg divide-y divide-line">
            {groupsQuery.data.map((group) => (
              <Link key={group.id} to={`/groups/${group.id}`} className={`flex items-center gap-3 px-4 py-3.5 ${focusRing} focus-visible:ring-inset ${rowClass}`}>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-ink group-hover:text-ledger">{group.name}</p>
                  <p className="text-xs text-ink-muted">
                    {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                  </p>
                </div>
                <p className={`figure text-sm font-medium ${group.yourBalanceMinor >= 0 ? "text-ledger" : "text-rust"}`}>
                  {group.yourBalanceMinor === 0
                    ? "Settled up"
                    : group.yourBalanceMinor > 0
                      ? `+${formatMoney(group.yourBalanceMinor, group.defaultCurrency)}`
                      : formatMoney(group.yourBalanceMinor, group.defaultCurrency)}
                </p>
                <RowChevron />
              </Link>
            ))}
          </div>
        )}
      </section>

      <OtherGroups title="Archived groups" groups={archivedQuery.data ?? []} />
      <OtherGroups title="Deleted groups" groups={deletedQuery.data ?? []} restorable />
    </AppShell>
  );
}

function OtherGroups({ title, groups, restorable = false }: { title: string; groups: GroupSummary[]; restorable?: boolean }) {
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return null;
  return (
    <section className={`mt-6 ${cardClass}`}>
      <DisclosureButton open={open} onClick={() => setOpen((v) => !v)}>
        {title} ({groups.length})
      </DisclosureButton>
      {open && (
        <ul className="divide-y divide-line border-t border-line text-sm">
          {groups.map((group) =>
            restorable ? (
              <li key={group.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 break-words text-ink-muted">{group.name}</span>
                <RestoreGroup groupId={group.id} />
              </li>
            ) : (
              <li key={group.id} className={`flex items-center gap-3 px-4 py-3 ${rowClass}`}>
                <RowLink to={`/groups/${group.id}`} className="min-w-0 flex-1 break-words">
                  {group.name}
                </RowLink>
                <RowChevron />
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function RestoreGroup({ groupId }: { groupId: string }) {
  const action = useGroupAction(groupId);
  return (
    <Button icon="restore" size="xs" onClick={() => action.mutate("restore")} disabled={action.isPending}>
      Restore
    </Button>
  );
}
