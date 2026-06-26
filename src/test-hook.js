/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Read-only: a generic KVS get covers seal records (protection-{id}), section
 * records (section-protection-{id} incl. stored hash), validation findings/gate,
 * and grants — the deterministic state the harness asserts against.
 */
import { kvs } from "@forge/kvs";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": ["application/json"] },
  body: JSON.stringify(body),
});
const notFound = () => ({ statusCode: 404, headers: { "Content-Type": ["text/plain"] }, body: "not found" });
const q = (req, n) => {
  const v = req && req.queryParameters && req.queryParameters[n];
  return Array.isArray(v) ? v[0] : v;
};

export async function testStateTrigger(req) {
  const secret = process.env.HARNESS_SECRET;
  if (!secret) return notFound();
  const authArr = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || null;
  const auth = Array.isArray(authArr) ? authArr[0] : authArr;
  const provided = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (!provided || provided !== secret) return notFound();

  const what = q(req, "what") || "kvs";
  try {
    if (what === "kvs") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      return json(200, { key, value: (await kvs.get(key)) ?? null });
    }
    // DEV-ONLY writes (gated by the same secret) so deterministic suites can set up
    // state (e.g. a validation rule) and restore it. `value` is URL-encoded JSON.
    if (what === "set") {
      const key = q(req, "key");
      const valueStr = q(req, "value");
      if (!key || valueStr === undefined) return json(400, { error: "key+value required" });
      await kvs.set(key, JSON.parse(valueStr));
      return json(200, { set: key });
    }
    if (what === "delete") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      await kvs.delete(key);
      return json(200, { deleted: key });
    }
    return json(400, { error: `unknown what=${what}` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}
