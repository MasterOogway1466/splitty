import { formatMoney } from "@splitty/shared";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { inputClass, linkButtonClass, primaryButtonClass } from "../components/styles.js";
import { ApiError } from "../lib/api.js";
import { useAddFriend, usePeopleBalances } from "../lib/hooks.js";

export function FriendsPage() {
  const peopleQuery = usePeopleBalances();
  const addFriend = useAddFriend();
  const [email, setEmail] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addFriend.mutateAsync(email);
      setEmail("");
      setShowAdd(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === "rate_limited" ? "Too many invites today. Try again tomorrow." : err.message) : "Something went wrong");
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-ink">Friends</h1>
        <button onClick={() => setShowAdd((v) => !v)} className={linkButtonClass}>
          {showAdd ? "Cancel" : "Add friend"}
        </button>
      </div>
      {showAdd && (
        <form onSubmit={handleAdd} className="mb-4 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            required
            className={`flex-1 ${inputClass}`}
          />
          <button type="submit" disabled={addFriend.isPending} className={primaryButtonClass}>
            {addFriend.isPending ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-rust mb-4">{error}</p>}
      {peopleQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {peopleQuery.data && peopleQuery.data.length === 0 && (
        <p className="text-sm text-ink-muted">No one here yet — add a friend or share a group with someone, and they'll show up here.</p>
      )}
      {peopleQuery.data && peopleQuery.data.length > 0 && (
        <div className="bg-white border border-line rounded-lg divide-y divide-line">
          {peopleQuery.data.map((person) => (
            <Link key={person.userId} to={`/people/${person.userId}`} className="flex items-center justify-between px-4 py-3.5 hover:bg-paper transition-colors">
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
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
