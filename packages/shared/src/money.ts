/**
 * All money is represented as integer minor units (e.g. cents), never floats.
 * Plain JS `number` is used rather than `bigint`: amounts never approach
 * Number.MAX_SAFE_INTEGER in practice, and `number` avoids bigint's JSON
 * serialization friction across the API boundary. Every value here must be
 * a safe integer; `assertMinorUnits` enforces that at the boundary.
 */
export type MinorUnits = number;

export function assertMinorUnits(value: number, label = "amount"): MinorUnits {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer minor-unit amount, got ${value}`);
  }
  return value;
}

/** Upper bound on any single entered amount. Far above real use, and low
 * enough that sums over thousands of entries stay
 * within Number.MAX_SAFE_INTEGER, where this arithmetic is exact. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;
export const MAX_SHARES = 1_000;

export interface WeightedParticipant {
  id: string;
  weight: number;
}

/**
 * Splits `totalMinor` across participants proportional to `weight`
 * (equal split: all weights equal; shares split: weight = share count;
 * percentage split: weight = percentage), as integers. Uses the largest-remainder
 * method with a deterministic tie-break on ascending participant id, per
 * docs/PLAN-PUBLIC.md §2 — fully reproducible from stored data alone, which
 * matters because edit history and offline replay both recompute this.
 */
export function splitByLargestRemainder(
  totalMinor: number,
  participants: WeightedParticipant[],
): Map<string, MinorUnits> {
  assertMinorUnits(totalMinor, "totalMinor");
  if (participants.length === 0) {
    throw new Error("splitByLargestRemainder requires at least one participant");
  }
  const ids = new Set(participants.map((p) => p.id));
  if (ids.size !== participants.length) {
    throw new Error("splitByLargestRemainder requires unique participant ids");
  }
  if (participants.some((p) => !Number.isSafeInteger(p.weight) || p.weight < 0)) {
    throw new Error("splitByLargestRemainder requires non-negative integer weights");
  }
  // BigInt because total × weight can exceed 2^53.
  const total = BigInt(totalMinor);
  const totalWeight = participants.reduce((sum, p) => sum + BigInt(p.weight), 0n);
  if (totalWeight === 0n) {
    throw new Error("splitByLargestRemainder requires a positive total weight");
  }

  const withRemainders = participants.map((p) => {
    const product = total * BigInt(p.weight);
    return { id: p.id, floor: Number(product / totalWeight), remainder: product % totalWeight };
  });

  const allocated = withRemainders.reduce((sum, p) => sum + p.floor, 0);
  const remaining = totalMinor - allocated;

  const byRemainderDesc = [...withRemainders].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder > a.remainder ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const result = new Map<string, MinorUnits>(withRemainders.map((p) => [p.id, p.floor]));
  for (let i = 0; i < remaining; i++) {
    const winner = byRemainderDesc[i]!;
    result.set(winner.id, result.get(winner.id)! + 1);
  }
  return result;
}

export function sumMinor(values: Iterable<number>): MinorUnits {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export interface PairwiseDebt {
  fromId: string; // owes
  toId: string; // is owed
  amountMinor: MinorUnits;
}

/**
 * Turns one expense's net positions (paid − owed, summing to zero) into
 * who-owes-whom (docs/PLAN-PUBLIC.md §7). Debtors are processed in
 * ascending id; each debt is divided in proportion to the credit each
 * creditor has *remaining* (largest remainder, ties to the lower id).
 * Using the remaining rather than original credit is what makes both the
 * debtors' and the creditors' totals come out exact. BigInt because
 * debt × credit can exceed 2^53.
 */
export function attributeDebts(netById: Map<string, MinorUnits>): PairwiseDebt[] {
  if (sumMinor(netById.values()) !== 0) {
    throw new Error("attributeDebts requires net positions that sum to zero");
  }
  const byId = [...netById.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const creditors = byId.filter(([, net]) => net > 0).map(([id, net]) => ({ id, remaining: BigInt(net) }));

  const debts: PairwiseDebt[] = [];
  for (const [fromId, net] of byId) {
    if (net >= 0) continue;
    const debt = BigInt(-net);
    const totalRemaining = creditors.reduce((sum, c) => sum + c.remaining, 0n);
    const shares = creditors.map((creditor) => ({
      creditor,
      amount: (debt * creditor.remaining) / totalRemaining,
      remainder: (debt * creditor.remaining) % totalRemaining,
    }));
    let leftover = debt - shares.reduce((sum, s) => sum + s.amount, 0n);
    // Stable sort: equal remainders keep the creditors' ascending-id order.
    for (const share of [...shares].sort((a, b) => (a.remainder > b.remainder ? -1 : a.remainder < b.remainder ? 1 : 0))) {
      if (leftover === 0n) break;
      share.amount += 1n;
      leftover -= 1n;
    }
    for (const { creditor, amount } of shares) {
      creditor.remaining -= amount;
      if (amount > 0n) debts.push({ fromId, toId: creditor.id, amountMinor: Number(amount) });
    }
  }
  return debts;
}
