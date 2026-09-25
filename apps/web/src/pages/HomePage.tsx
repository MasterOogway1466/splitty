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

  return (
    <AppShell>
      <section className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Overview</h1>
        {balanceQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {balanceQuery.data && balanceQuery.data.length === 0 && <p className="text-sm text-slate-500">You're all settled up.</p>}
        {balanceQuery.data && balanceQuery.data.length > 0 && (
          <ul className="space-y-1">
            {balanceQuery.data.map((b) => (
              <li key={b.currency} className={`text-sm ${b.netMinor >= 0 ? "text-green-700" : "text-red-700"}`}>
                {b.netMinor >= 0
                  ? `You are owed ${formatMoney(b.netMinor, b.currency)}`
                  : `You owe ${formatMoney(-b.netMinor, b.currency)}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-900">Groups</h2>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-sm rounded-md bg-slate-900 text-white px-3 py-1.5 hover:bg-slate-700"
          >
            {showForm ? "Cancel" : "New group"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mb-4 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Group name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Default currency</span>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                required
                className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm uppercase"
              />
            </label>
            <button
              type="submit"
              disabled={createGroup.isPending}
              className="rounded-md bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-700 disabled:opacity-50"
            >
              {createGroup.isPending ? "Creating…" : "Create group"}
            </button>
          </form>
        )}

        {groupsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {groupsQuery.data && groupsQuery.data.length === 0 && (
          <p className="text-sm text-slate-500">No groups yet — create one to start splitting expenses.</p>
        )}
        <ul className="space-y-2">
          {groupsQuery.data?.map((group) => (
            <li key={group.id}>
              <Link
                to={`/groups/${group.id}`}
                className="block bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-400 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{group.name}</p>
                    <p className="text-xs text-slate-500">
                      {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className={`text-sm font-medium ${group.yourBalanceMinor >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {group.yourBalanceMinor === 0
                      ? "Settled up"
                      : group.yourBalanceMinor > 0
                        ? `+${formatMoney(group.yourBalanceMinor, group.defaultCurrency)}`
                        : formatMoney(group.yourBalanceMinor, group.defaultCurrency)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
