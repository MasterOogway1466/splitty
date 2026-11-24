/**
 * Minor-unit exponents for currency math. Most currencies use 2 (cents);
 * a few use 0 (e.g. JPY) or 3 (e.g. BHD). This must match the seeded
 * `currencies` table in the API — kept here too so both the API and the
 * frontend can format/parse money without a round trip for common cases.
 */
export const CURRENCY_MINOR_UNIT_EXPONENT: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  SGD: 2,
  NZD: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
};

// The full set of currencies the app supports, for building selectors and
// server-side validation — every currency a user can ever be offered comes
// from this list, matching the seeded `currencies` DB table.
export const CURRENCY_CODES = Object.keys(CURRENCY_MINOR_UNIT_EXPONENT) as [string, ...string[]];

export function minorUnitExponent(currencyCode: string): number {
  const exponent = CURRENCY_MINOR_UNIT_EXPONENT[currencyCode.toUpperCase()];
  if (exponent === undefined) {
    throw new Error(`Unknown currency code: ${currencyCode}`);
  }
  return exponent;
}

export function minorToMajor(amountMinor: number, currencyCode: string): number {
  const exponent = minorUnitExponent(currencyCode);
  return amountMinor / 10 ** exponent;
}

export function majorToMinor(amountMajor: number, currencyCode: string): number {
  const exponent = minorUnitExponent(currencyCode);
  return Math.round(amountMajor * 10 ** exponent);
}

/** Parses a money form field into minor units, honoring the currency's own
 * exponent. Returns NaN for anything that isn't an exact amount in that
 * currency (e.g. "1.5" JPY) — money input is never silently rounded. */
export function parseMoneyInput(value: string, currencyCode: string): number {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  const whole = match?.[2] ?? "";
  const fraction = match?.[3] ?? "";
  const exponent = minorUnitExponent(currencyCode);
  if (!match || whole + fraction === "" || fraction.length > exponent) return NaN;
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  if (!Number.isSafeInteger(minor)) return NaN;
  return match[1] && minor !== 0 ? -minor : minor;
}

/** Inverse of parseMoneyInput, for pre-filling a form field. */
export function formatMoneyInput(amountMinor: number, currencyCode: string): string {
  return minorToMajor(amountMinor, currencyCode).toFixed(minorUnitExponent(currencyCode));
}

/** The `step` (and smallest positive amount) for a money `<input>`. */
export function moneyInputStep(currencyCode: string): string {
  return formatMoneyInput(1, currencyCode);
}
