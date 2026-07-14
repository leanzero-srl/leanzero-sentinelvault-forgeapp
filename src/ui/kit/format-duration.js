// Human-readable "time remaining until a seal lapses". Rolls up to days so a long seal reads
// "360d 3h", never "8643h 56m" — nobody parses time in thousands of hours. Shared so every
// surface (overlay, realm-console) formats a seal countdown IDENTICALLY (it28 fixed the overlay
// in isolation; this centralises it so the surfaces can't drift apart again).
//   • no expiry        → "-"
//   • already lapsed    → "Overdue"
//   • < 1 hour          → "45m"
//   • < 25 hours        → "6h 12m"
//   • otherwise         → "3d 0h" / "360d 3h"
export function formatRemaining(expiresAt) {
  if (!expiresAt) return "-";
  const diffMs = new Date(expiresAt) - new Date();
  if (diffMs <= 0) return "Overdue";
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// it57: human-readable rendering of a fixed DURATION given in whole hours (for config INPUTS like the
// seal hold period), so a steward setting "720" sees "= 30 days" instead of parsing raw hours.
// Not a countdown (see formatRemaining). 720 → "30 days", 48 → "2 days", 27 → "1 day 3h", 6 → "6 hours".
export function formatDurationHours(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return "";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const days = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  const dPart = `${days} day${days === 1 ? "" : "s"}`;
  return rem === 0 ? dPart : `${dPart} ${rem}h`;
}
