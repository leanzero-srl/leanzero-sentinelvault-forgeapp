// TOTP seeds in the KVS SECRET namespace (Marketplace security requirement 5, 2026-10-04).
// Proves the read-through migration against an in-memory store with two namespaces, and pins
// the signature capsule to the secret store with a static scan (a plain kvs.get/set of a seed
// key is the regression this file exists to stop).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { readSecret, writeSecret, deleteSecretEverywhere } from "../src/server/shared/secret-store.js";

function fakeStore() {
  const plain = new Map();
  const secret = new Map();
  const calls = [];
  return {
    plain, secret, calls,
    async get(k) { calls.push(["get", k]); return plain.get(k); },
    async set(k, v) { calls.push(["set", k]); plain.set(k, v); },
    async delete(k) { calls.push(["delete", k]); plain.delete(k); },
    async getSecret(k) { calls.push(["getSecret", k]); return secret.get(k); },
    async setSecret(k, v, o) { calls.push(["setSecret", k, o || null]); secret.set(k, v); },
    async deleteSecret(k) { calls.push(["deleteSecret", k]); secret.delete(k); },
  };
}
const hasSecret = (v) => !!(v && v.secret);

// 1. A legacy plain row is moved into the secret namespace on first read, and the plain row is gone.
{
  const s = fakeStore();
  s.plain.set("sig-secret-A", { secret: "JBSWY3DP", enrolledAt: "2026-09-01T00:00:00.000Z" });
  let migrated = null;
  const v = await readSecret("sig-secret-A", { store: s, isValid: hasSecret, onMigrated: (x) => { migrated = x; } });
  eq("legacy read returns the record", v?.secret, "JBSWY3DP");
  eq("legacy row now lives in the secret namespace", s.secret.get("sig-secret-A")?.secret, "JBSWY3DP");
  eq("legacy plain row deleted", s.plain.has("sig-secret-A"), false);
  eq("onMigrated told about the moved record", migrated?.enrolledAt, "2026-09-01T00:00:00.000Z");
  // 2. The second read comes from the secret namespace and touches no plain row.
  s.calls.length = 0;
  const v2 = await readSecret("sig-secret-A", { store: s, isValid: hasSecret });
  eq("second read still returns the seed", v2?.secret, "JBSWY3DP");
  eq("second read is a single getSecret", s.calls.map((c) => c[0]), ["getSecret"]);
}

// 3. Nothing anywhere → null, nothing written.
{
  const s = fakeStore();
  eq("absent → null", await readSecret("sig-secret-B", { store: s, isValid: hasSecret }), null);
  ok("absent → no write", !s.calls.some((c) => c[0] === "set" || c[0] === "setSecret"));
}

// 4. A malformed plain row (no secret) is not promoted.
{
  const s = fakeStore();
  s.plain.set("sig-secret-C", { enrolledAt: "x" });
  eq("malformed plain → null", await readSecret("sig-secret-C", { store: s, isValid: hasSecret }), null);
  eq("malformed plain left alone", s.secret.has("sig-secret-C"), false);
}

// 5. When both exist the secret wins and the plain twin is not resurrected over it.
{
  const s = fakeStore();
  s.secret.set("sig-secret-D", { secret: "NEW" });
  s.plain.set("sig-secret-D", { secret: "OLD" });
  eq("secret namespace wins", (await readSecret("sig-secret-D", { store: s, isValid: hasSecret }))?.secret, "NEW");
}

// 6. writeSecret: secret namespace, ttl option passed through, plain twin removed.
{
  const s = fakeStore();
  s.plain.set("sig-enroll-E", { secret: "OLD" });
  await writeSecret("sig-enroll-E", { secret: "P" }, { ttl: { value: 900, unit: "SECONDS" } }, { store: s });
  eq("write lands in secret namespace", s.secret.get("sig-enroll-E")?.secret, "P");
  eq("ttl option reaches setSecret", s.calls.find((c) => c[0] === "setSecret")?.[2], { ttl: { value: 900, unit: "SECONDS" } });
  eq("plain twin removed on write", s.plain.has("sig-enroll-E"), false);
}

// 7. deleteSecretEverywhere clears both namespaces.
{
  const s = fakeStore();
  s.secret.set("k", { secret: 1 });
  s.plain.set("k", { secret: 2 });
  await deleteSecretEverywhere("k", { store: s });
  eq("both namespaces cleared", [s.secret.has("k"), s.plain.has("k")], [false, false]);
}

// 8. Static guard: the signature capsule never reads or writes a seed key with a plain kvs call.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "../src/server/capsules/workflow/signature.js"), "utf8");
  ok("no plain kvs.get/set/delete on secretKey/enrollKey", !/kvs\.(get|set|delete)\(\s*(secretKey|enrollKey)\(/.test(src));
  ok("no setWithTtl on enrollKey", !/setWithTtl\(\s*enrollKey\(/.test(src));
  ok("seed writes go through writeSecret", /writeSecret\(secretKey\(/.test(src) && /writeSecret\(enrollKey\(/.test(src));
  ok("a device marker is written for the backup inventory", /kvs\.set\(deviceKey\(/.test(src));
}

report("secret-store");
