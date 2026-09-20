import { describe, expect, it } from "vitest";
import { splitByLargestRemainder, sumMinor } from "./money.js";

describe("splitByLargestRemainder", () => {
  it("always sums exactly to the total (equal split, not evenly divisible)", () => {
    const result = splitByLargestRemainder(1000, [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
    ]);
    expect(sumMinor(result.values())).toBe(1000);
  });

  it("sums exactly to the total across many random totals and participant counts", () => {
    for (let trial = 0; trial < 200; trial++) {
      const total = Math.floor(Math.random() * 100_000);
      const count = 1 + Math.floor(Math.random() * 8);
      const participants = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        weight: 1 + Math.floor(Math.random() * 5),
      }));
      const result = splitByLargestRemainder(total, participants);
      expect(sumMinor(result.values())).toBe(total);
    }
  });

  it("is deterministic and reproducible from the same inputs", () => {
    const participants = [
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
    ];
    const first = splitByLargestRemainder(100, participants);
    const second = splitByLargestRemainder(100, participants);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });

  it("breaks remainder ties by ascending participant id", () => {
    // 10 split three ways: each gets exact 3.333..., all remainders tied at
    // .333, and only one leftover minor unit to hand out (10 - 3*3 = 1).
    const result = splitByLargestRemainder(10, [
      { id: "c", weight: 1 },
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
    ]);
    // lowest id (a) wins the single extra unit ahead of b and c.
    expect(result.get("a")).toBe(4);
    expect(result.get("b")).toBe(3);
    expect(result.get("c")).toBe(3);
  });

  it("honors weighted shares (e.g. 2 shares vs 1 share)", () => {
    const result = splitByLargestRemainder(300, [
      { id: "couple", weight: 2 },
      { id: "single", weight: 1 },
    ]);
    expect(result.get("couple")).toBe(200);
    expect(result.get("single")).toBe(100);
    expect(sumMinor(result.values())).toBe(300);
  });

  it("rejects a non-integer total", () => {
    expect(() => splitByLargestRemainder(10.5, [{ id: "a", weight: 1 }])).toThrow();
  });

  it("rejects duplicate participant ids", () => {
    expect(() =>
      splitByLargestRemainder(100, [
        { id: "a", weight: 1 },
        { id: "a", weight: 1 },
      ]),
    ).toThrow();
  });
});
