import { describe, expect, it } from "vitest";
import { formatMoneyInput, moneyInputStep, parseMoneyInput } from "./currency.js";

describe("money input helpers", () => {
  it("parses using the currency's own minor unit", () => {
    expect(parseMoneyInput("1000", "JPY")).toBe(1000);
    expect(parseMoneyInput("12.34", "USD")).toBe(1234);
    expect(parseMoneyInput("12.3", "USD")).toBe(1230);
    expect(parseMoneyInput("1.234", "BHD")).toBe(1234);
    expect(parseMoneyInput("-2.50", "USD")).toBe(-250);
    expect(parseMoneyInput(".5", "USD")).toBe(50);
  });

  it("returns NaN rather than rounding or guessing", () => {
    for (const [value, currency] of [["1.5", "JPY"], ["1.005", "USD"], ["", "USD"], [".", "USD"], ["abc", "USD"], ["99999999999999999", "USD"]] as const) {
      expect(parseMoneyInput(value, currency)).toBeNaN();
    }
  });

  it("formats for an input field and round-trips", () => {
    expect(formatMoneyInput(1000, "JPY")).toBe("1000");
    expect(formatMoneyInput(1234, "USD")).toBe("12.34");
    expect(formatMoneyInput(1234, "BHD")).toBe("1.234");
    for (const currency of ["JPY", "USD", "BHD"]) {
      expect(parseMoneyInput(formatMoneyInput(98765, currency), currency)).toBe(98765);
    }
  });

  it("gives a matching input step", () => {
    expect([moneyInputStep("JPY"), moneyInputStep("USD"), moneyInputStep("BHD")]).toEqual(["1", "0.01", "0.001"]);
  });
});
