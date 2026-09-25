import { formatMoney } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { usePeopleBalances } from "../lib/hooks.js";

export function FriendsPage() {
  const peopleQuery = usePeopleBalances();

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-slate-900 mb-4">Friends</h1>
      {peopleQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {peopleQuery.data && peopleQuery.data.length === 0 && (
        <p className="text-sm text-slate-500">
          No one here yet — share a group with someone, or record a direct expense, and they'll show up here.
        </p>
      )}
      <ul className="space-y-2">
        {peopleQuery.data?.map((person) => (
          <li key={person.userId} className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
            <span className="text-slate-900">{person.displayName}</span>
            <div className="text-sm text-right">
              {person.balances.length === 0 && <span className="text-slate-400">settled up</span>}
              {person.balances.map((b) => (
                <div key={b.currency} className={b.netMinor >= 0 ? "text-green-700" : "text-red-700"}>
                  {b.netMinor === 0
                    ? "settled up"
                    : b.netMinor > 0
                      ? `owes you ${formatMoney(b.netMinor, b.currency)}`
                      : `you owe ${formatMoney(-b.netMinor, b.currency)}`}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
