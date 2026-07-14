import { formatDurationHours, formatRemaining } from "../src/ui/kit/format-duration.js";
import { eq, report } from "./_assert.mjs";

// it57: formatDurationHours renders a config duration (whole hours) in human units, so a steward
// setting "720" sees "30 days" instead of parsing raw hours.
eq("720h → 30 days", formatDurationHours(720), "30 days");
eq("48h → 2 days", formatDurationHours(48), "2 days");
eq("24h → 1 day (singular)", formatDurationHours(24), "1 day");
eq("27h → 1 day 3h", formatDurationHours(27), "1 day 3h");
eq("6h → 6 hours", formatDurationHours(6), "6 hours");
eq("1h → 1 hour (singular)", formatDurationHours(1), "1 hour");
eq("fractional rounds the hour remainder", formatDurationHours(26.6), "1 day 3h");
eq("0 → empty", formatDurationHours(0), "");
eq("negative → empty", formatDurationHours(-5), "");
eq("non-numeric → empty", formatDurationHours("abc"), "");
eq("undefined → empty", formatDurationHours(undefined), "");

// formatRemaining regression (the existing shared countdown helper)
eq("no expiry → -", formatRemaining(null), "-");
eq("past → Overdue", formatRemaining(new Date(Date.now() - 3600000).toISOString()), "Overdue");

report("format-duration");
