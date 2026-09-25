import { z } from "zod";

// Phase 1 has no real FX conversion yet (that's Phase 3, docs/PLAN-PUBLIC.md
// §10) — `base_amount_minor` is set equal to `amount_minor` for now (§2's
// decision, frozen-conversion design, with fx_rate=1 as the Phase 1
// placeholder). Summing across different currencies would silently mix
// unit systems, so balances that can span multiple currencies (pairwise,
// global) are reported as one entry per currency rather than a single
// collapsed number. Per-group balances are always single-currency, since
// Phase 1 constrains a group's expenses to the group's own default
// currency (relaxed once real FX conversion lands).
export const currencyBalanceSchema = z.object({
  currency: z.string(),
  netMinor: z.number().int(), // positive = they owe you / you're owed; negative = you owe them
});
export type CurrencyBalance = z.infer<typeof currencyBalanceSchema>;

export const pairwiseBalanceSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  balances: z.array(currencyBalanceSchema),
});
export type PairwiseBalance = z.infer<typeof pairwiseBalanceSchema>;
