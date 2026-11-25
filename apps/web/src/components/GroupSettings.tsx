import { useState, type FormEvent } from "react";
import { CURRENCY_CODES, groupTypeValues, type DefaultSplit, type GroupDetail } from "@splitty/shared";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useUpdateGroup } from "../lib/hooks.js";
import { personLabel } from "../lib/members.js";
import { Button } from "./Button.js";
import { inputClass } from "./styles.js";

const TYPE_LABELS: Record<(typeof groupTypeValues)[number], string> = { trip: "Trip", house: "House", couple: "Couple", other: "Other" };
const METHOD_LABELS: Record<DefaultSplit["method"], string> = { equal: "Equally", percentage: "By percentage", shares: "By shares" };

export function GroupSettings({ group, onDone }: { group: GroupDetail; onDone: () => void }) {
  const { user } = useAuth();
  const update = useUpdateGroup(group.id);
  const saved = group.defaultSplit;
  const [name, setName] = useState(group.name);
  const [groupType, setGroupType] = useState(group.groupType);
  const [currency, setCurrency] = useState(group.defaultCurrency);
  const [simplify, setSimplify] = useState(group.simplifyDebts);
  const [method, setMethod] = useState<DefaultSplit["method"] | "none">(saved?.method ?? "none");
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries((saved?.values ?? group.members.map((m) => ({ userId: m.userId, value: 1 }))).map((v) => [v.userId, String(v.value)])),
  );
  const [error, setError] = useState<string | null>(null);

  function buildSplit(): DefaultSplit | null | { error: string } {
    if (method === "none") return null;
    const included = group.members.filter((m) => Number(values[m.userId] || "0") > 0);
    if (included.length === 0) return { error: "Include at least one person in the default split" };
    const entries = included.map((m) => ({ userId: m.userId, value: method === "equal" ? 1 : Number(values[m.userId]) }));
    if (method === "percentage") {
      const total = entries.reduce((s, e) => s + Math.round(e.value * 100), 0);
      if (total !== 10_000) return { error: `Percentages add up to ${total / 100}%, not 100%` };
    }
    return { method, values: entries };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const defaultSplit = buildSplit();
    if (defaultSplit && "error" in defaultSplit) {
      setError(defaultSplit.error);
      return;
    }
    try {
      await update.mutateAsync({
        name,
        groupType,
        simplifyDebts: simplify,
        defaultSplit,
        ...(group.canChangeCurrency ? { defaultCurrency: currency } : {}),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 bg-white border border-line rounded-lg p-4 space-y-3 text-sm text-ink">
      <label className="block">
        <span className="block font-medium mb-1">Group name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className={inputClass} />
      </label>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="block font-medium mb-1">Type</span>
          <select value={groupType} onChange={(e) => setGroupType(e.target.value as GroupDetail["groupType"])} className={inputClass}>
            {groupTypeValues.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1">
          <span className="block font-medium mb-1">Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!group.canChangeCurrency} className={`${inputClass} disabled:opacity-50`}>
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!group.canChangeCurrency && <p className="text-xs text-ink-muted">The currency is fixed once something has been recorded.</p>}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} className="accent-ledger" />
        Simplify debts into fewer payments
      </label>
      <label className="block">
        <span className="block font-medium mb-1">Default split for new expenses</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as DefaultSplit["method"] | "none")} className={inputClass}>
          <option value="none">Equally between everyone</option>
          {(Object.keys(METHOD_LABELS) as DefaultSplit["method"][]).map((m) => (
            <option key={m} value={m}>
              {m === "equal" ? "Equally between some people" : METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {method !== "none" && (
        <div className="space-y-1.5">
          {group.members.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 text-ink-muted">
              <span className="flex-1">{personLabel(m, user?.id)}</span>
              {method === "equal" ? (
                <input
                  type="checkbox"
                  checked={Number(values[m.userId] || "0") > 0}
                  onChange={(e) => setValues({ ...values, [m.userId]: e.target.checked ? "1" : "0" })}
                  className="accent-ledger"
                />
              ) : (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={values[m.userId] ?? ""}
                  onChange={(e) => setValues({ ...values, [m.userId]: e.target.value })}
                  placeholder={method === "percentage" ? "%" : "shares"}
                  className="w-24 rounded-md border border-edge bg-white px-2 py-1 text-xs text-ink"
                />
              )}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-rust">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="md" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
        <Button size="md" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
