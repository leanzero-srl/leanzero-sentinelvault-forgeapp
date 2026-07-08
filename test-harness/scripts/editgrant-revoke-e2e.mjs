// audit D5: the edit-grant list + REVOKE resolvers existed and were registered but NO UI
// ever called them (a phantom feature — approved edit access was permanent). The panel now
// wires them; this proves the backend actually lists + revokes, with the owner authorization.
// Pure KVS + resolver test (owner auth is a direct lockedBy comparison — no asUser needed).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HR = "/Users/mihaiperdum/Projects/Sentinel Vault/test-harness";
let total = 0, passed = 0;
const check = (l, c) => { total++; if (c) { passed++; console.log(`ok   ${l}`); } else { console.log(`FAIL ${l}`); } };
function parseEnv(t){const o={};for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0)o[s.slice(0,i).trim()]=s.slice(i+1).trim();}return o;}
const env = { ...process.env };
for (const p of [join(HR, ".env"), join(homedir(), "Projects/forge-live-harness/.env")]) if (existsSync(p)) for (const [k,v] of Object.entries(parseEnv(readFileSync(p,"utf8")))) if(!env[k]) env[k]=v;
const HOOK = { url: env.SENTINEL_TESTHOOK_URL, secret: env.HARNESS_SECRET };
const hook = async (params) => { const r = await fetch(`${HOOK.url}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${HOOK.secret}` } }); const t = await r.text(); if (!r.ok) throw new Error(`hook ${params.fn || params.what} ${r.status}`); return JSON.parse(t); };
const kvsGet = async (key) => (await hook({ what: "kvs", key })).value;
const kvsSet = (key, value) => hook({ what: "set", key, value: JSON.stringify(value) });
const kvsDel = (key) => hook({ what: "delete", key }).catch(() => {});

const att = `editgrant-probe-${Date.now()}`;
const OWNER = "owner-acct", EDITOR = "editor-acct", STRANGER = "stranger-acct";
const future = new Date(Date.now() + 30 * 86400000).toISOString();
try {
  await kvsSet(`protection-${att}`, { lockedBy: OWNER, spaceKey: "WFH", attachmentName: "probe.txt", expiresAt: future });
  await kvsSet(`edit-grant-${att}-${EDITOR}`, { artifactId: att, editorAccountId: EDITOR, editorName: "Editor Acct", grantedBy: OWNER, grantedAt: new Date().toISOString(), expiresAt: future });

  const asOwner = (await hook({ what: "invoke", fn: "listEditGrants", att, actor: OWNER })).result;
  check("owner lists the active grant", (asOwner?.grants || []).some((g) => g.editorAccountId === EDITOR));

  const asStranger = (await hook({ what: "invoke", fn: "listEditGrants", att, actor: STRANGER })).result;
  check("a non-owner/non-steward is NOT authorized to list grants", (asStranger?.grants || []).length === 0);

  const badRevoke = (await hook({ what: "invoke", fn: "revokeEditGrant", att, editor: EDITOR, actor: STRANGER })).result;
  check("a non-owner cannot revoke", badRevoke?.success === false);
  check("the grant still exists after an unauthorized revoke", !!(await kvsGet(`edit-grant-${att}-${EDITOR}`)));

  const revoke = (await hook({ what: "invoke", fn: "revokeEditGrant", att, editor: EDITOR, actor: OWNER })).result;
  check("owner revoke reports success", revoke?.success === true);
  check("the grant is actually deleted after revoke", !(await kvsGet(`edit-grant-${att}-${EDITOR}`)));

  const after = (await hook({ what: "invoke", fn: "listEditGrants", att, actor: OWNER })).result;
  check("the revoked editor no longer appears in the list", !(after?.grants || []).some((g) => g.editorAccountId === EDITOR));
} finally {
  await kvsDel(`protection-${att}`);
  await kvsDel(`edit-grant-${att}-${EDITOR}`);
  console.log("     cleaned up");
}

console.log(`\neditgrant-revoke-e2e: ${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
