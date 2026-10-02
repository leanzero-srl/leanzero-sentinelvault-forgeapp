// Pillar 12 guard: every Forge storage key family the code writes is CLASSIFIED in
// src/server/capsules/backup/families.js (config → backed up, secret → never, runtime → rebuilt).
// A new family that nobody classified would land in "Other app data" — backed up by default, which
// is the safe side for data but the wrong side for a new SECRET. So the build fails until a human
// decides. Static scan (the capsules pull @forge/* and cannot all load under plain node).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { FAMILIES, OTHER_FAMILY, familyOf, isBackedUp } from "../src/server/capsules/backup/families.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../src/server");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
walk(root);
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

// Literals that sit on storage-ish lines but are NOT KVS keys: resolver/op names, queue names,
// Confluence content-property keys, labels, macro keys, web-trigger keys.
const actionKeys = new Set([...source.matchAll(/\[\s*"([a-z0-9-]+)",\s*\w+\s*\]/g)].map((m) => m[1]));
const NOT_KEYS = [
  /-queue$/, /^sentinel-/, /^sv-state-$/, /^config-api$/,
  /^(seal|unseal|extend|grant|revoke|decline)-(attachment|section)(-edit)?$/, /^classify-page$/, /^recheck-validation$/,
  /^approve-validation$/, /^idempotency-key$/,
];
const lineRe = /kvs\.|beginsWith|setWithTtl|setUntil|Key\s*=|Key\(|KEY\s*=|PREFIX\s*=|[Pp]refix\s*[:=]|_KEY\b|Key\s*:|\bkey\s*=/;
const heads = new Map();
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    if (!lineRe.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
    const where = `${f.slice(root.length + 1)}:${i + 1}`;
    for (const m of l.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)*[-:]?)\$\{/g)) heads.set(m[1], where);
    for (const m of l.matchAll(/["']([a-z][a-z0-9]*(?:-[a-z0-9]+)+[-:]?)["']/g)) heads.set(m[1], where);
  });
}
let checked = 0;
for (const [head, where] of heads) {
  if (actionKeys.has(head) || NOT_KEYS.some((re) => re.test(head))) continue;
  checked++;
  // `head` may be a stem joined with "-" later (`${indexPrefix}-${owner}`): try both shapes.
  ok(`storage key "${head}" (${where}) is classified in backup/families.js`, familyOf(`${head}x`) !== OTHER_FAMILY || familyOf(`${head}-x`) !== OTHER_FAMILY);
}
ok("the scan found the known families (sanity: it is not reading nothing)", checked >= 80);

// Every family row names a prefix the code really uses (a typo would silently classify nothing).
for (const f of FAMILIES) {
  const stem = f.prefix.replace(/[-:]$/, "");
  ok(`family "${f.prefix}" appears in the source`, source.includes(stem));
}

// Longest prefix wins where families overlap.
eq("ai-finding-state- is config", familyOf("ai-finding-state-1").cls, "config");
eq("ai-finding- history is runtime", familyOf("ai-finding-1-123").cls, "runtime");
eq("page-guard sweep cursor is runtime", familyOf("page-guard-sweep-cursor").cls, "runtime");
eq("section-protection- is its own family", familyOf("section-protection-abc").prefix, "section-protection-");
eq("protection- is sealed files", familyOf("protection-att1").label, "Sealed files");
eq("space-protection- index is not protection-", familyOf("space-protection-1-att1").prefix, "space-protection-");
eq("protections-last-modified is runtime", familyOf("protections-last-modified").cls, "runtime");
eq("workflow-def-space extras ride workflow-def-", familyOf("workflow-def-space-WFH-review").prefix, "workflow-def-");
eq("api-tokens is a secret", familyOf("api-tokens").cls, "secret");
eq("TOTP secrets are secrets", familyOf("sig-secret-712020:x").cls, "secret");
eq("backup bookkeeping is not in the backup", isBackedUp("backup-status"), false);
eq("activity site leg is backed up", isBackedUp("activity-site-0001-abc"), true);
eq("an unknown key is backed up as Other", familyOf("brand-new-thing-1"), OTHER_FAMILY);
ok("no secret family is ever backed up", FAMILIES.filter((f) => f.cls === "secret").every((f) => !isBackedUp(`${f.prefix}x`)));
report("backup-families");
