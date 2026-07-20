export type CheckOutcome = "Setback" | "Success with Cost" | "Clean Success";

export const CHECK_OUTCOME_RANGES: Readonly<Record<CheckOutcome, string>> = {
  Setback: "6 or less",
  "Success with Cost": "7-9",
  "Clean Success": "10 or more",
};

export const checkOutcomeFor = (total: number): CheckOutcome =>
  total <= 6 ? "Setback" : total <= 9 ? "Success with Cost" : "Clean Success";
