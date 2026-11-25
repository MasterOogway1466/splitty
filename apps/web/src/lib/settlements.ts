import type { Settlement } from "@splitty/shared";

export type SettlementMethod = Settlement["method"];

export const METHOD_LABELS: Record<SettlementMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  other: "Other",
};
