import { useState, type FormEvent } from "react";
import { formatMoney, memberColorValues, type GroupDetail, type MemberColor } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useAddGroupMember, useRemoveGroupMember, useSetMemberColor } from "../lib/hooks.js";
import { COLOR_SWATCH_CLASS, personLabel } from "../lib/members.js";
import { inputClass, linkButtonClass, primaryButtonClass } from "./styles.js";

export function MembersSection({ group }: { group: GroupDetail }) {
  const { user } = useAuth();
  const addMember = useAddGroupMember(group.id);
  const removeMember = useRemoveGroupMember(group.id);
  const setMemberColor = useSetMemberColor(group.id);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const currency = group.defaultCurrency;
  const isOwner = group.members.find((m) => m.userId === user?.id)?.role === "owner";

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    setMemberError(null);
    try {
      await addMember.mutateAsync(memberEmail);
      setMemberEmail("");
      setShowAddMember(false);
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  async function handleRemove(userId: string) {
    setMemberError(null);
    try {
      await removeMember.mutateAsync(userId);
    } catch (err) {
      setMemberError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <section className="mb-6 bg-white border border-line rounded-lg">
      <div className="flex items-center justify-between px-4 py-3.5">
        <h2 className="font-medium text-ink">Members</h2>
          {!group.archivedAt && (
          <button onClick={() => setShowAddMember((v) => !v)} className={linkButtonClass}>
            {showAddMember ? "Cancel" : "Add member"}
          </button>
          )}
      </div>
      {showAddMember && (
        <form onSubmit={handleAddMember} className="mx-4 mb-4 flex gap-2">
          <input
            type="email"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
            placeholder="email@example.com"
            required
            className={`flex-1 ${inputClass}`}
          />
          <button type="submit" disabled={addMember.isPending} className={primaryButtonClass}>
            {addMember.isPending ? "Adding…" : "Add"}
          </button>
        </form>
      )}
      {memberError && <p className="text-sm text-rust px-4 mb-3">{memberError}</p>}
      <div className="divide-y divide-line border-t border-line">
        {group.members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between text-sm px-4 py-3">
            <span className="flex items-center gap-2 text-ink">
              {m.color && <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_SWATCH_CLASS[m.color]}`} />}
              {personLabel(m, user?.id)}
              {m.role === "owner" && <span className="text-xs text-gold font-medium">· Owner</span>}
            </span>
            <div className="flex items-center gap-3">
              {m.userId === user?.id && (
                <select
                  value={m.color ?? ""}
                  onChange={(e) => setMemberColor.mutate((e.target.value || null) as MemberColor | null)}
                  className="rounded-md border border-line px-1.5 py-1 text-xs text-ink-muted focus:outline-none focus:ring-2 focus:ring-ledger/40"
                >
                  <option value="">No color</option>
                  {memberColorValues.map((c) => (
                    <option key={c} value={c}>
                      {c[0]!.toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              )}
              <span className={`figure ${m.netBalanceMinor >= 0 ? "text-ledger" : "text-rust"}`}>
                {m.netBalanceMinor === 0 ? "settled up" : formatMoney(m.netBalanceMinor, currency)}
              </span>
              {isOwner && !group.archivedAt && m.userId !== user?.id && (
                <button onClick={() => handleRemove(m.userId)} className="text-xs text-ink-muted hover:text-rust transition-colors">
                  remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
