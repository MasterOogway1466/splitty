import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { useCreateGroup, useGlobalBalance, useGroups } from "../lib/hooks.js";

export function HomePage() {
  const groupsQuery = useGroups();
  const balanceQuery = useGlobalBalance();
  const createGroup = useCreateGroup();
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
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-sm rounded-md bg-ledger text-paper px-3 py-1.5 hover:bg-ledger-dark transition-colors"
          >
            {showForm ? "Cancel" : "New group"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mb-4 bg-white border border-line rounded-lg p-4 space-y-3">
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Group name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-ink mb-1">Default currency</span>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                required
                className="w-24 rounded-md border border-line px-3 py-2 text-sm text-ink uppercase focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
              />
            </label>
            <button
              type="submit"
              disabled={createGroup.isPending}
              className="rounded-md bg-ledger text-paper text-sm font-medium px-4 py-2 hover:bg-ledger-dark transition-colors disabled:opacity-50"
            >
              {createGroup.isPending ? "Creating…" : "Create group"}
            </button>
          </form>
        )}

        {groupsQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
        {groupsQuery.data && groupsQuery.data.length === 0 && (
          <p className="text-sm text-ink-muted">No groups yet — create one to start splitting expenses.</p>
        )}
        {groupsQuery.data && groupsQuery.data.length > 0 && (
          <div className="bg-white border border-line rounded-lg divide-y divide-line">
            {groupsQuery.data.map((group) => (
              <Link key={group.id} to={`/groups/${group.id}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-paper transition-colors">
                <div>
                  <p className="font-medium text-ink">{group.name}</p>
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
              </Link>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
