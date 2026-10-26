// The "lower the monthly allowance" field of AiAllowanceCard, as pure functions so node tests can
// drive it. The field keeps the TEXT the admin types (a controlled number input bound to the stored
// micro-dollars emptied "0." and snapped "1" to the default mid-keystroke, so $0.05 could not be
// typed); the value is converted and clamped only when the admin leaves the field.

/** The text shown for a stored micro-dollar value ("" = the default). */
export function draftOf(micro) {
  const m = Number(micro);
  return Number.isFinite(m) && m > 0 ? String(m / 1e6) : "";
}

/** Accept a keystroke: digits with at most one decimal point (and up to 6 decimals), or empty. */
export function acceptDraft(prev, next) {
  const t = String(next ?? "").replace(",", ".").trim();
  return t === "" || /^\d*\.?\d{0,6}$/.test(t) ? t : prev;
}

/** Commit on blur: micro-dollars to store (0 = back to the default). Never above the default. */
export function commitDraft(text, defaultMicro) {
  const v = parseFloat(String(text ?? "").replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return 0;
  const micro = Math.round(v * 1e6);
  return micro >= Number(defaultMicro) ? 0 : micro;
}
