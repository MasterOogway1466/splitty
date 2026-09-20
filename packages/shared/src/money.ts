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

export interface WeightedParticipant {
  id: string;
  weight: number;
}

/**
 * Splits `totalMinor` across participants proportional to `weight`
 * (equal split: all weights equal; shares split: weight = share count;
 * percentage split: weight = percentage). Uses the largest-remainder
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
  const totalWeight = participants.reduce((sum, p) => sum + p.weight, 0);
  if (!(totalWeight > 0)) {
    throw new Error("splitByLargestRemainder requires a positive total weight");
  }

  const withRemainders = participants.map((p) => {
    const exact = (totalMinor * p.weight) / totalWeight;
    const floor = Math.floor(exact);
    return { id: p.id, floor, remainder: exact - floor };
  });

  const allocated = withRemainders.reduce((sum, p) => sum + p.floor, 0);
  const remaining = totalMinor - allocated;

  const byRemainderDesc = [...withRemainders].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
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
