import { formatMoney } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { usePeopleBalances } from "../lib/hooks.js";

export function FriendsPage() {
  const peopleQuery = usePeopleBalances();

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-ink mb-4">Friends</h1>
      {peopleQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {peopleQuery.data && peopleQuery.data.length === 0 && (
        <p className="text-sm text-ink-muted">No one here yet — share a group with someone, or record a direct expense, and they'll show up here.</p>
      )}
      {peopleQuery.data && peopleQuery.data.length > 0 && (
        <div className="bg-white border border-line rounded-lg divide-y divide-line">
          {peopleQuery.data.map((person) => (
            <div key={person.userId} className="flex items-center justify-between px-4 py-3.5">
              <span className="text-ink">{person.displayName}</span>
              <div className="text-sm text-right">
                {person.balances.length === 0 && <span className="text-ink-muted">settled up</span>}
                {person.balances.map((b) => (
                  <div key={b.currency} className={b.netMinor >= 0 ? "text-ledger" : "text-rust"}>
                    {b.netMinor === 0 ? (
                      "settled up"
                    ) : b.netMinor > 0 ? (
                      <>
                        owes you <span className="figure font-medium">{formatMoney(b.netMinor, b.currency)}</span>
                      </>
                    ) : (
                      <>
                        you owe <span className="figure font-medium">{formatMoney(-b.netMinor, b.currency)}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
