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
