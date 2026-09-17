/**
 * Settings schema — the PURE description of every policy control the two consoles show
 * (UX review 2026-09-14 §3, P2). No Forge imports: `test/settings-schema.test.mjs` runs it in
 * plain node, and both Custom UI bundles import it so the consoles render FROM this table instead
 * of carrying their own copy of the keys, defaults and dependencies.
 *
 * Three things live here and nowhere else:
 *   1. the descriptor table — key, group, label, one-line "what happens when this is on", the
 *      engine default (read from baseline.js, never re-typed) and how the engine reads the key
 *      (`optIn`: `=== true`; otherwise `!== false`), so `readEffective` mirrors the engine;
 *   2. the dependency table — which key needs which parent at which value, so a nested control
 *      is disabled with "Turn on {parent} first" for exactly the pairs the engine enforces;
 *   3. the first-run mapping — seal-duration presets and the three alert profiles → the keys
 *      they write.
 */
import { POLICY_DEFAULTS, SPACE_POLICY_DEFAULTS, withinHoldBounds } from "../../shared/baseline.js";
import { DEFAULT_RIBBON_MODE, DEFAULT_RIBBON_THRESHOLD_RANK } from "../../../ui/kit/ribbon-rules.js";
import { NOTIFICATIONS_MODES } from "../../shared/notice-policy.js";
import { EDIT_COOLDOWN_HOURS_MAX } from "../../shared/edit-cooldown.js";

export const GROUPS = Object.freeze([
  { id: "protection", name: "Protection", text: "What gets sealed and who may act on it." },
  { id: "expiry", name: "Expiry", text: "How long a seal lasts and what happens when it runs out." },
  { id: "alerts", name: "Alerts", text: "Who hears about it, and how." },
  { id: "advanced", name: "Advanced", text: "Panel insertion, content rules, AI review and the rarely-used switches." },
]);

/**
 * `kind`: toggle | hours | days | count | choice | seconds-as-hours (stored seconds, edited hours).
 * `parent` + `parentValue`: the control only takes effect when `parent` reads as `parentValue`.
 * `scope`: global (site console) | space (space console). Space overrides carry `siteKey` — the
 * global key whose effective value is the "Site default: …" a space admin is overriding.
 */
export const CONTROLS = Object.freeze([
  // ── Protection ────────────────────────────────────────────────────────────────────────────
  { key: "allowAdminOverride", scope: "global", group: "protection", kind: "toggle",
    label: "Allow space admins to force-unseal",
    text: "A space admin can release anyone's seal from the Sealed Files tab, with a recorded reason.",
    default: POLICY_DEFAULTS.allowAdminOverride },
  { key: "enableContentProtection", scope: "global", group: "protection", kind: "toggle",
    label: "Protect Sealed Attachments in Page Body",
    text: "An edit that removes a sealed image or file from the page body is undone and the editor is told why.",
    default: POLICY_DEFAULTS.enableContentProtection },
  { key: "allowArtifactDelete", scope: "global", group: "protection", kind: "toggle", optIn: true,
    label: "Allow Attachment Removal from Page",
    text: "Users can send unsealed attachments to the trash from the Sentinel Vault panel.",
    default: POLICY_DEFAULTS.allowArtifactDelete },
  { key: "allowSealRestore", scope: "global", group: "protection", kind: "toggle", optIn: true,
    label: "Allow Attachment Restore from Page",
    text: "Trashed attachments that still carry a seal can be restored from the panel.",
    default: POLICY_DEFAULTS.allowSealRestore },
  { key: "allowSealPurge", scope: "global", group: "protection", kind: "toggle", optIn: true,
    label: "Allow Seal Cleanup from Page",
    text: "Seal records left behind by permanently deleted attachments can be removed from the panel.",
    default: POLICY_DEFAULTS.allowSealPurge },
  { key: "editRequestCooldownHours", scope: "global", group: "protection", kind: "hours", min: 0, max: EDIT_COOLDOWN_HOURS_MAX,
    label: "Hours before a declined edit request can be repeated",
    text: "After an owner declines an edit request, the same person waits this long before asking again. 0 lets them ask again at once. The owner can give edit access directly at any time.",
    default: POLICY_DEFAULTS.editRequestCooldownHours },

  // ── Expiry ────────────────────────────────────────────────────────────────────────────────
  { key: "defaultLockDuration", scope: "global", group: "expiry", kind: "seconds-as-hours",
    label: "Default Seal Duration",
    text: "How long a new seal lasts. A space can set its own duration in its Seal Duration tab.",
    default: POLICY_DEFAULTS.defaultLockDuration },
  { key: "autoUnlockEnabled", scope: "global", group: "expiry", kind: "toggle",
    label: "Seals expire",
    text: "The owner gets a halfway notice, an expiry notice and the overdue reminders below, then the attachment is released. Off: seals never expire and owners see a recurring banner instead.",
    default: POLICY_DEFAULTS.autoUnlockEnabled },
  { key: "lapseNoticeLimit", scope: "global", group: "expiry", kind: "count", min: 0,
    label: "Overdue reminders before release",
    text: "How many overdue reminders the owner gets before the seal is released. 0 reminds once and holds the seal.",
    default: POLICY_DEFAULTS.lapseNoticeLimit, parent: "autoUnlockEnabled", parentValue: true },
  { key: "lapseNoticeIntervalHours", scope: "global", group: "expiry", kind: "hours", min: 1,
    label: "Hours between overdue reminders",
    text: "The gap between one overdue reminder and the next.",
    default: POLICY_DEFAULTS.lapseNoticeIntervalHours, parent: "autoUnlockEnabled", parentValue: true },
  { key: "enablePeriodicReminderEmail", scope: "global", group: "expiry", kind: "toggle",
    label: "Recurring reminder banner",
    text: "Owners of never-expiring seals see a banner on the page every few days. A banner only — no comment is posted.",
    default: POLICY_DEFAULTS.enablePeriodicReminderEmail, parent: "autoUnlockEnabled", parentValue: false },
  { key: "reminderIntervalDays", scope: "global", group: "expiry", kind: "days", min: 1,
    label: "Reminder Frequency",
    text: "Days between one recurring reminder banner and the next.",
    default: POLICY_DEFAULTS.reminderIntervalDays, parent: "enablePeriodicReminderEmail", parentValue: true },

  // ── Alerts ────────────────────────────────────────────────────────────────────────────────
  { key: "enableFlashMessages", scope: "global", group: "alerts", kind: "toggle",
    label: "Pop-up messages",
    text: "A brief message appears when you seal or release an attachment, or when an action is refused.",
    default: POLICY_DEFAULTS.enableFlashMessages },
  { key: "enableDocRibbons", scope: "global", group: "alerts", kind: "toggle",
    label: "Page ribbon",
    text: "The Sentinel Vault ribbon at the top of pages with sealed content, showing what is sealed and until when.",
    default: POLICY_DEFAULTS.enableDocRibbons },
  { key: "ribbonMode", scope: "global", group: "alerts", kind: "choice",
    label: "Ribbon",
    text: "What opens the ribbon: only exceptions, or the classification block on every page.",
    default: DEFAULT_RIBBON_MODE, parent: "enableDocRibbons", parentValue: true },
  { key: "ribbonThresholdRank", scope: "global", group: "alerts", kind: "count", min: 1, max: 99,
    label: "Ribbon classification threshold",
    text: "In “Exceptions only”, a page classified at this rank or higher opens the ribbon on its own (default scheme: Public 1 · Internal 2 · Confidential 3 · Restricted 4).",
    default: DEFAULT_RIBBON_THRESHOLD_RANK, parent: "enableDocRibbons", parentValue: true },
  { key: "notifyEditorOnRevert", scope: "global", group: "alerts", kind: "toggle",
    label: "Tell editors when their change is undone",
    text: "When Sentinel Vault reverts someone's edit to sealed content, that person gets a page comment saying so, with a link to the version that still holds their text. Works on its own — it does not need the comments switch below. Quiet spaces stay quiet.",
    default: POLICY_DEFAULTS.notifyEditorOnRevert },
  { key: "enableEmailDispatches", scope: "global", group: "alerts", kind: "toggle", optIn: true,
    label: "Page comments that mention people",
    text: "Seal events, edit requests, approvals and violations post a comment on the page that @mentions the people involved; Confluence then notifies them. Master switch for every comment below. The app sends no email.",
    default: POLICY_DEFAULTS.enableEmailDispatches },
  { key: "enableConfluenceDispatches", scope: "global", group: "alerts", kind: "toggle", optIn: true,
    label: "Violation comments",
    text: "A comment is posted on the page when someone tampers with a sealed attachment or section.",
    default: POLICY_DEFAULTS.enableConfluenceDispatches, parent: "enableEmailDispatches", parentValue: true },
  { key: "enableSealExpiryReminderEmail", scope: "global", group: "alerts", kind: "toggle",
    label: "Seal confirmation and halfway notice",
    text: "The owner is mentioned when a seal is created and again at its midpoint.",
    default: POLICY_DEFAULTS.enableSealExpiryReminderEmail, parent: "enableEmailDispatches", parentValue: true },
  { key: "enableAutoUnsealDispatchEmail", scope: "global", group: "alerts", kind: "toggle",
    label: "Expiry and release notices",
    text: "The owner is mentioned when a seal expires, at each overdue reminder, and when the attachment is released.",
    default: POLICY_DEFAULTS.enableAutoUnsealDispatchEmail, parent: "enableEmailDispatches", parentValue: true },

  // ── Advanced ──────────────────────────────────────────────────────────────────────────────
  { key: "globalAutoInsertMacro", scope: "global", group: "advanced", kind: "toggle", optIn: true,
    label: "Auto-Insert Macro on Seal",
    text: "The first seal on a page adds the Sentinel Vault panel to it. Off: no space can auto-insert, whatever its own setting says.",
    default: POLICY_DEFAULTS.globalAutoInsertMacro },
  { key: "replaceAttachmentsMacro", scope: "global", group: "advanced", kind: "toggle", optIn: true,
    label: "Replace Attachments Macro",
    text: "The panel takes the place of Confluence's Attachments macro when the page has one; otherwise it goes where the space says.",
    default: POLICY_DEFAULTS.replaceAttachmentsMacro, parent: "globalAutoInsertMacro", parentValue: true },

  // ── Space overrides ───────────────────────────────────────────────────────────────────────
  { key: "autoUnlockTimeoutHours", scope: "space", group: "expiry", kind: "hours", min: 1, nullable: true,
    label: "Custom Seal Duration",
    text: "Seals on attachments in this space last this long instead of the site default.",
    default: SPACE_POLICY_DEFAULTS.autoUnlockTimeoutHours, siteKey: "defaultLockDuration" },
  { key: "autoInsertMacro", scope: "space", group: "advanced", kind: "toggle",
    label: "Auto-Insert Macro",
    text: "The first seal on a page in this space adds the Sentinel Vault panel to it.",
    default: SPACE_POLICY_DEFAULTS.autoInsertMacro, parent: "globalAutoInsertMacro", parentValue: true, siteKey: "globalAutoInsertMacro" },
  { key: "macroInsertPosition", scope: "space", group: "advanced", kind: "choice",
    label: "Macro Position",
    text: "Where the panel is inserted: top or bottom of the page body. Ignored when the site replaces the Attachments macro.",
    default: SPACE_POLICY_DEFAULTS.macroInsertPosition, parent: "autoInsertMacro", parentValue: true },
  { key: "notificationsMode", scope: "space", group: "alerts", kind: "choice",
    label: "Notifications",
    text: "Quiet posts no comments and mentions nobody in this space; pop-ups, the ribbon and the activity trail still work.",
    default: SPACE_POLICY_DEFAULTS.notificationsMode, siteKey: "enableEmailDispatches" },
]);

const BY_KEY = new Map(CONTROLS.map((c) => [c.key, c]));
export const control = (key) => BY_KEY.get(key) || null;
export const controlsFor = (scope, group) => CONTROLS.filter((c) => c.scope === scope && (!group || c.group === group));

/**
 * The value the engine applies for `key` given what is stored — the SAME coercion the reader
 * uses: opt-in toggles need `=== true`, opt-out ones `!== false`, numbers must be finite and in
 * range, choices must be one of the known values. `undefined` and a malformed value both
 * resolve to the effective default.
 */
export function readEffective(key, stored) {
  const c = control(key);
  if (!c) return undefined;
  switch (c.kind) {
    case "toggle":
      return c.optIn ? stored === true : stored !== false;
    case "seconds-as-hours":
      return withinHoldBounds(stored) ? stored : c.default;
    case "hours":
    case "days":
    case "count": {
      if (c.nullable && (stored === null || stored === undefined)) return null;
      const n = Number(stored);
      if (!Number.isFinite(n)) return c.default;
      if (c.min !== undefined && n < c.min) return c.default;
      if (c.max !== undefined && n > c.max) return c.default;
      return Math.floor(n);
    }
    case "choice":
      if (key === "ribbonMode") return stored === "always" ? "always" : "exceptions";
      if (key === "macroInsertPosition") return stored === "top" ? "top" : "bottom";
      if (key === "notificationsMode") return stored === "quiet" ? "quiet" : "normal";
      return stored ?? c.default;
    default:
      return stored ?? c.default;
  }
}

/** Every control's effective value for one stored record — what the console binds its inputs to. */
export function readAllEffective(scope, stored) {
  const out = {};
  for (const c of CONTROLS) if (c.scope === scope) out[c.key] = readEffective(c.key, stored?.[c.key]);
  return out;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** Human text for a value of `key` — used for both "Effective default: …" and "Site default: …". */
export function formatValue(key, value) {
  const c = control(key);
  if (!c) return String(value);
  switch (c.kind) {
    case "toggle": return value ? "On" : "Off";
    case "seconds-as-hours": {
      const h = Math.round(Number(value) / 3600);
      return h >= 24 && h % 24 === 0 ? `${plural(h, "hour")} (${plural(h / 24, "day")})` : plural(h, "hour");
    }
    case "hours": {
      if (value === null || value === undefined) return "Site default";
      const h = Number(value);
      return h >= 24 && h % 24 === 0 ? `${plural(h, "hour")} (${plural(h / 24, "day")})` : plural(h, "hour");
    }
    case "days": return plural(Number(value), "day");
    case "count": return String(value);
    case "choice":
      if (key === "ribbonMode") return value === "always" ? "Always show classification" : "Exceptions only";
      if (key === "macroInsertPosition") return value === "top" ? "Top of the page" : "Bottom of the page";
      if (key === "notificationsMode") return value === "quiet" ? "Quiet" : "Normal";
      return String(value);
    default: return String(value);
  }
}

export const formatDefault = (key) => formatValue(key, control(key)?.default);

/**
 * The dependency table: `{ child, parent, parentValue }` for every nested control. Derived from
 * the descriptors so it cannot drift from what the consoles render.
 */
export function dependencyTable(scope) {
  return CONTROLS.filter((c) => c.parent && (!scope || c.scope === scope))
    .map((c) => ({ child: c.key, parent: c.parent, parentValue: c.parentValue }));
}

/**
 * Is `key` usable given the current effective values? Returns `{ enabled, reason }`; `reason`
 * is the sentence the console shows on the disabled control. `siteValues` supplies the
 * effective GLOBAL values when the parent lives on the site (a space override under a global
 * master), and the sentence then names the site admin rather than the space admin.
 */
export function dependencyState(key, values, siteValues = null) {
  const c = control(key);
  if (!c || !c.parent) return { enabled: true, reason: null };
  const parent = control(c.parent);
  const parentIsSite = parent && parent.scope === "global" && c.scope === "space";
  const source = parentIsSite ? siteValues || {} : values || {};
  const have = source[c.parent];
  if (have === c.parentValue) return { enabled: true, reason: null };
  const verb = c.parentValue === false ? "Turn off" : "Turn on";
  if (parentIsSite) return { enabled: false, reason: `Off site-wide by a site admin (${parent.label}).` };
  return { enabled: false, reason: `${verb} ${parent ? parent.label : c.parent} first` };
}

// ── First-run setup ─────────────────────────────────────────────────────────────────────────

export const SEAL_DURATION_PRESETS = Object.freeze([
  { id: "1d", label: "1 day", hours: 24 },
  { id: "3d", label: "3 days", hours: 72 },
  { id: "1w", label: "1 week", hours: 168 },
  { id: "2w", label: "2 weeks", hours: 336 },
  { id: "30d", label: "30 days", hours: 720 },
  { id: "custom", label: "Custom", hours: null },
]);

export const ALERT_PROFILES = Object.freeze([
  { id: "quiet", name: "Quiet", text: "In-app only: pop-ups and the page ribbon. Nothing is posted on pages." },
  { id: "standard", name: "Standard", text: "In-app, plus a page comment for violations, edit requests and approvals. No seal-lifecycle notices." },
  { id: "loud", name: "Loud", text: "Every comment type: violations, requests, approvals, seal confirmations, halfway, expiry and release notices." },
]);

/**
 * The alert profile → the persisted keys. Every profile keeps pop-ups and the ribbon ON; the
 * comment master (`enableEmailDispatches`) and the violation footnote follow the profile, and
 * the two seal-lifecycle sub-types are what separate Standard from Loud. Unknown → quiet.
 */
export function alertProfileToFlags(profileId) {
  switch (profileId) {
    case "loud":
      return {
        enableFlashMessages: true, enableDocRibbons: true,
        enableEmailDispatches: true, enableConfluenceDispatches: true,
        enableSealExpiryReminderEmail: true, enableAutoUnsealDispatchEmail: true,
      };
    case "standard":
      return {
        enableFlashMessages: true, enableDocRibbons: true,
        enableEmailDispatches: true, enableConfluenceDispatches: true,
        enableSealExpiryReminderEmail: false, enableAutoUnsealDispatchEmail: false,
      };
    default:
      return {
        enableFlashMessages: true, enableDocRibbons: true,
        enableEmailDispatches: false, enableConfluenceDispatches: false,
      };
  }
}

/** The inverse, for showing which profile a stored record currently matches (or "custom"). */
export function flagsToAlertProfile(values) {
  const v = readAllEffective("global", values);
  if (!v.enableEmailDispatches) return v.enableConfluenceDispatches ? "custom" : "quiet";
  if (!v.enableConfluenceDispatches) return "custom";
  if (v.enableSealExpiryReminderEmail && v.enableAutoUnsealDispatchEmail) return "loud";
  if (!v.enableSealExpiryReminderEmail && !v.enableAutoUnsealDispatchEmail) return "standard";
  return "custom";
}

/**
 * Build the `store-policy` payload for Finish: the mapped keys + `setupCompletedAt`. `hours`
 * is the chosen seal duration in hours (a preset or a custom number); anything not a positive
 * finite number is refused with a reason rather than silently defaulted.
 */
export function buildSetupPayload({ hours, profile, completedAt }) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 1 || !withinHoldBounds(h * 3600)) {
    return { ok: false, reason: "Seal duration must be at least 1 hour." };
  }
  return {
    ok: true,
    data: {
      defaultLockDuration: Math.floor(h) * 3600,
      ...alertProfileToFlags(profile),
      setupCompletedAt: completedAt || new Date().toISOString(),
    },
  };
}

/** True when the site console should open on the first-run setup instead of the settings. */
export const needsSetup = (globalRecord) => !globalRecord || !globalRecord.setupCompletedAt;

// ── Write-path validation (store-policy calls this; the UI never trusts its own inputs) ────

const isInt = (n) => Number.isInteger(n);

/**
 * Validate the keys of a `store-policy` payload that the schema owns. Only the keys PRESENT are
 * checked (a partial save leaves the rest untouched, audit A3); null means "unset / inherit" for
 * the nullable ones. Returns `{ ok }` or `{ ok:false, reason }`.
 */
export function validatePolicyWrite(scope, data) {
  if (!data || typeof data !== "object") return { ok: true };
  if (scope === "global") {
    for (const key of ["lapseNoticeLimit", "reminderIntervalDays"]) {
      if (data[key] != null) {
        const c = control(key);
        if (!isInt(data[key]) || data[key] < c.min) return { ok: false, reason: `${c.label} must be a whole number of at least ${c.min}.` };
      }
    }
    if (data.lapseNoticeIntervalHours != null && (!isInt(data.lapseNoticeIntervalHours) || data.lapseNoticeIntervalHours < 1)) {
      return { ok: false, reason: "Hours between overdue reminders must be a whole number of at least 1." };
    }
    if (data.editRequestCooldownHours != null && (!isInt(data.editRequestCooldownHours) || data.editRequestCooldownHours < 0 || data.editRequestCooldownHours > EDIT_COOLDOWN_HOURS_MAX)) {
      return { ok: false, reason: `Hours before a declined edit request can be repeated must be a whole number from 0 to ${EDIT_COOLDOWN_HOURS_MAX}.` };
    }
    if (data.setupCompletedAt != null) {
      const t = typeof data.setupCompletedAt === "string" ? Date.parse(data.setupCompletedAt) : NaN;
      if (!Number.isFinite(t)) return { ok: false, reason: "setupCompletedAt must be an ISO-8601 timestamp." };
    }
    for (const c of CONTROLS) {
      if (c.scope === "global" && c.kind === "toggle" && c.key in data && data[c.key] != null && typeof data[c.key] !== "boolean") {
        return { ok: false, reason: `${c.label} must be true or false.` };
      }
    }
  } else if (scope === "space") {
    if ("notificationsMode" in data && data.notificationsMode != null && !NOTIFICATIONS_MODES.includes(data.notificationsMode)) {
      return { ok: false, reason: `Notifications must be one of: ${NOTIFICATIONS_MODES.join(", ")}.` };
    }
    if ("macroInsertPosition" in data && data.macroInsertPosition != null && !["top", "bottom"].includes(data.macroInsertPosition)) {
      return { ok: false, reason: "Macro position must be top or bottom." };
    }
    if ("autoInsertMacro" in data && data.autoInsertMacro != null && typeof data.autoInsertMacro !== "boolean") {
      return { ok: false, reason: "Auto-Insert Macro must be true or false." };
    }
  }
  return { ok: true };
}

/**
 * Keys the write path DROPS: `activation` never had a server reader (UX review §3.2 — "nothing
 * resolves it"), `overrideGlobalSettings` was written and never read. Stripping them here is
 * what "remove the inert control" means on the server side.
 */
export const DEAD_SPACE_KEYS = Object.freeze(["activation", "overrideGlobalSettings"]);
export function stripDeadKeys(scope, data) {
  if (scope !== "space" || !data || typeof data !== "object") return data;
  const out = { ...data };
  for (const k of DEAD_SPACE_KEYS) delete out[k];
  return out;
}
