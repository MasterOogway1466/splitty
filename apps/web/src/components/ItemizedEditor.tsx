import { formatMoney, moneyInputStep, parseMoneyInput } from "@splitty/shared";
import type { ItemDraft } from "../lib/expenseDraft.js";
import { personLabel, type Person } from "../lib/members.js";
import { Button } from "./Button.js";
import { inputClass } from "./styles.js";

export interface ItemizedDraft {
  items: ItemDraft[];
  tax: string;
  tip: string;
}

export function ItemizedEditor(props: {
  people: Person[];
  currency: string;
  currentUserId: string | undefined;
  value: ItemizedDraft;
  onChange: (value: ItemizedDraft) => void;
}) {
  const { people, currency, currentUserId, value, onChange } = props;
  const moneyStep = moneyInputStep(currency);
  const total = [...value.items.map((i) => i.amount), value.tax, value.tip].reduce((s, v) => s + (parseMoneyInput(v, currency) || 0), 0);

  function patchItem(index: number, change: Partial<ItemDraft>) {
    onChange({ ...value, items: value.items.map((item, i) => (i === index ? { ...item, ...change } : item)) });
  }
  function toggle(index: number, userId: string) {
    const shares = { ...value.items[index]!.shares };
    if (shares[userId] === undefined) shares[userId] = 1;
    else delete shares[userId];
    patchItem(index, { shares });
  }

  return (
    <div className="mt-2 space-y-3">
      {value.items.map((item, index) => (
        <div key={index} className="rounded-md border border-line bg-white p-2 space-y-2">
          <div className="flex gap-2">
            <input
              aria-label={`Item ${index + 1}`}
              value={item.description}
              onChange={(e) => patchItem(index, { description: e.target.value })}
              placeholder="Item"
              maxLength={200}
              className={`flex-1 min-w-0 ${inputClass} py-1.5`}
            />
            <input
              type="number"
              aria-label={`Item ${index + 1} amount`}
              step={moneyStep}
              min={moneyStep}
              value={item.amount}
              onChange={(e) => patchItem(index, { amount: e.target.value })}
              placeholder={currency}
              className="w-24 rounded-md border border-edge px-2 py-1.5 text-sm text-ink"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {people.map((p) => (
              <label key={p.userId} className="flex items-center gap-1.5 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={item.shares[p.userId] !== undefined}
                  onChange={() => toggle(index, p.userId)}
                  className="accent-ledger"
                />
                {personLabel(p, currentUserId)}
              </label>
            ))}
            {value.items.length > 1 && (
              <Button
                size="xs"
                className="ml-auto"
                aria-label={`Remove item ${index + 1}`}
                onClick={() => onChange({ ...value, items: value.items.filter((_, i) => i !== index) })}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      ))}
      <Button
        icon="plus"
        onClick={() => onChange({ ...value, items: [...value.items, { description: "", amount: "", shares: {} }] })}
      >
        Add item
      </Button>
      <div className="flex gap-2">
        {(["tax", "tip"] as const).map((field) => (
          <label key={field} className="flex-1 text-ink-muted">
            {field === "tax" ? "Tax" : "Tip"}
            <input
              type="number"
              step={moneyStep}
              min="0"
              value={value[field]}
              onChange={(e) => onChange({ ...value, [field]: e.target.value })}
              className={`mt-1 ${inputClass} py-1.5`}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-muted">
        Total <span className="figure text-ink font-medium">{formatMoney(total, currency)}</span>. Tax and tip are shared in proportion to what
        each person had.
      </p>
    </div>
  );
}
