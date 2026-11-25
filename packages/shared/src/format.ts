import { minorToMajor } from "./currency.js";

/** Single source of truth for money/date display — currency symbol and
 * decimal placement vary even within English locales, so every UI surface
 * routes through this rather than formatting money ad hoc. */
export function formatMoney(amountMinor: number, currencyCode: string, locale = "en-US"): string {
  const major = minorToMajor(amountMinor, currencyCode);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode.toUpperCase(),
  }).format(major);
}

export function formatDate(date: Date, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatDateTime(date: Date, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** For a YYYY-MM-DD calendar date, which must not shift with the timezone. */
export function formatCalendarDate(value: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

/** Today in the device's own timezone, as YYYY-MM-DD. */
export function todayCalendarDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
