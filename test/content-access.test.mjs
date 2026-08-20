import { grantsAccess, mustVerify, READ, UPDATE } from "../src/server/shared/content-access.js";
import { eq, report } from "./_assert.mjs";

// The pure core of the SV-SEC-1 authorization gate. Both functions decide whether a privileged
// asApp() operation runs, so every branch here is a security decision, not a formatting one.

// --- grantsAccess: only an explicit yes on a 2xx is a yes ---
eq("explicit hasPermission:true on a 2xx allows",
  grantsAccess(true, { hasPermission: true }), true);
eq("explicit hasPermission:false denies",
  grantsAccess(true, { hasPermission: false }), false);

// Probed live against Confluence: an accountId the site cannot resolve comes back 404 with a
// NotFoundException body — NOT hasPermission:false. Reading only the body would miss it.
eq("404 (unresolvable account) denies, whatever the body says",
  grantsAccess(false, { statusCode: 404, message: "NotFoundException" }), false);
eq("400 (operation invalid for this content type) denies",
  grantsAccess(false, { statusCode: 400 }), false);
eq("403 denies", grantsAccess(false, {}), false);

// Malformed / absent bodies must never read as an allow.
eq("null body denies", grantsAccess(true, null), false);
eq("undefined body denies", grantsAccess(true, undefined), false);
eq("empty body denies", grantsAccess(true, {}), false);
eq("truthy-but-not-true hasPermission denies (no coercion)",
  grantsAccess(true, { hasPermission: "true" }), false);
eq("hasPermission:1 denies (no coercion)",
  grantsAccess(true, { hasPermission: 1 }), false);
eq("ok must be exactly true, not truthy",
  grantsAccess(1, { hasPermission: true }), false);

// --- mustVerify: which ids need the extra round-trip ---
eq("no payload id → nothing client-named, no check",
  mustVerify(undefined, "123"), false);
eq("null payload id → no check", mustVerify(null, "123"), false);
eq("empty-string payload id → no check", mustVerify("", "123"), false);

eq("payload id equal to the context id → no check",
  mustVerify("123", "123"), false);
eq("equal across string/number → no check (Forge hands ids back in both shapes)",
  mustVerify(123, "123"), false);

eq("payload id naming DIFFERENT content → check",
  mustVerify("999", "123"), true);
eq("payload id with NO context to anchor against → check",
  mustVerify("999", undefined), true);
eq("payload id with a null context → check", mustVerify("999", null), true);
eq("payload id with an empty-string context → check", mustVerify("999", ""), true);

// The operation names are part of the wire contract with Confluence: "read" and "update" are
// accepted for content, while e.g. "administer" is rejected with a 400 (probed live).
eq("READ is the literal wire value", READ, "read");
eq("UPDATE is the literal wire value", UPDATE, "update");

report("content-access");
