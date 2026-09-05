// B3: per-approval e-signature. Forge has no re-authentication API, so the strongest claim an
// app can make is "the approver proved possession of a device enrolled with this app" — a
// TOTP the app enrols itself (shared/totp.js). Not a Part 11 claim; we do not make one.
//
//   sig-secret-{accountId}   { secret, enrolledAt }        the enrolled device (no TTL)
//   sig-enroll-{accountId}   { secret, at }                a pending enrolment (15-minute TTL)
//   sig-last-{accountId}     { step, at }                  the last accepted time-step → a code
//                                                          is never accepted twice (replay)
// The secret is read by the app only; it is never returned after enrolment is confirmed.
import { kvs } from "@forge/kvs";
import { setWithTtl } from "../../shared/kvs-ttl.js";
import { generateSecret, verifyTotp, otpauthUri } from "../../shared/totp.js";

const secretKey = (a) => `sig-secret-${a}`;
const enrollKey = (a) => `sig-enroll-${a}`;
const lastKey = (a) => `sig-last-${a}`;
const failKey = (a) => `sig-fail-${a}`;
const ENROLL_TTL_MS = 15 * 60 * 1000;
// Brute force (review finding 3): six digits and a three-code window is ~3×10⁻⁶ per try, and a
// wrong code writes nothing — so the failures ARE counted here: after MAX_FAILS wrong codes the
// account's signature is refused for LOCKOUT_MS, whatever the code.
export const MAX_FAILS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

// PURE. Is this account locked out, given its failure record?
export function isLockedOut(fail, nowMs = Date.now()) {
  return !!(fail && fail.count >= MAX_FAILS && fail.until && Date.parse(fail.until) > nowMs);
}

async function noteFailure(accountId) {
  const cur = (await kvs.get(failKey(accountId))) || { count: 0 };
  const count = (cur.count || 0) + 1;
  const rec = { count, at: new Date().toISOString(), until: count >= MAX_FAILS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null };
  await setWithTtl(failKey(accountId), rec, LOCKOUT_MS);
  if (count >= MAX_FAILS) console.warn(`[SIGNATURE] ${MAX_FAILS} wrong codes for ${accountId} — refusing signatures for ${LOCKOUT_MS / 60000} minutes`);
  return rec;
}

// A code is required to touch an EXISTING device (review finding 2): whoever holds the session
// must still hold the device to replace or remove it, or the second factor is not one.
async function requireCurrentDevice(accountId, code) {
  const s = await kvs.get(secretKey(accountId));
  if (!s?.secret) return { ok: true };
  const v = await verifySignature(accountId, code);
  if (!v.ok) return { ok: false, reason: `Your current signature is set up — enter its code first. ${v.reason}` };
  return { ok: true };
}

export async function signatureStatus(accountId) {
  if (!accountId) return { enrolled: false, pending: false };
  const s = await kvs.get(secretKey(accountId));
  const p = await kvs.get(enrollKey(accountId));
  return { enrolled: !!s?.secret, enrolledAt: s?.enrolledAt || null, pending: !!p?.secret };
}

// Start (or restart) an enrolment: a fresh secret the user adds to their authenticator. The
// secret leaves the app exactly once, here, so the QR can be drawn client-side (no egress).
export async function startEnrollment(accountId, { accountLabel, code } = {}) {
  if (!accountId) return { success: false, reason: "No account" };
  const gate = await requireCurrentDevice(accountId, code);
  if (!gate.ok) return { success: false, reason: gate.reason, codeRequired: true };
  const secret = generateSecret();
  await setWithTtl(enrollKey(accountId), { secret, at: new Date().toISOString() }, ENROLL_TTL_MS);
  return { success: true, secret, uri: otpauthUri({ secret, account: accountLabel || accountId }) };
}

// Prove the device works before it becomes THE device: the first code must verify.
export async function confirmEnrollment(accountId, code) {
  if (!accountId) return { success: false, reason: "No account" };
  const p = await kvs.get(enrollKey(accountId));
  if (!p?.secret) return { success: false, reason: "No enrolment is in progress — start again" };
  const step = verifyTotp(p.secret, code);
  if (step == null) return { success: false, reason: "That code did not match — check the time on your device and try the next code" };
  await kvs.set(secretKey(accountId), { secret: p.secret, enrolledAt: new Date().toISOString() });
  await kvs.set(lastKey(accountId), { step, at: new Date().toISOString() });
  await kvs.delete(enrollKey(accountId)).catch(() => {});
  return { success: true };
}

export async function revokeSignature(accountId, { code } = {}) {
  if (!accountId) return { success: false, reason: "No account" };
  const gate = await requireCurrentDevice(accountId, code);
  if (!gate.ok) return { success: false, reason: gate.reason, codeRequired: true };
  for (const k of [secretKey(accountId), enrollKey(accountId), lastKey(accountId), failKey(accountId)]) await kvs.delete(k).catch(() => {});
  return { success: true };
}

// Verify a code for an enrolled account; accepted steps are recorded so no code is reused.
// Returns { ok, reason?, signature? } — `signature` is what a decision record stores.
export async function verifySignature(accountId, code) {
  if (!accountId) return { ok: false, reason: "No account" };
  const s = await kvs.get(secretKey(accountId));
  if (!s?.secret) return { ok: false, reason: "You have not set up an approval signature yet — do that on your My work page first" };
  if (!code) return { ok: false, reason: "Enter the current code from your authenticator to sign this decision" };
  const fail = await kvs.get(failKey(accountId));
  if (isLockedOut(fail)) return { ok: false, reason: `Too many wrong codes — signatures for your account are refused until ${new Date(fail.until).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC`, lockedOut: true };
  const last = await kvs.get(lastKey(accountId));
  const step = verifyTotp(s.secret, code, { lastStep: typeof last?.step === "number" ? last.step : null });
  if (step == null) {
    const rec = await noteFailure(accountId);
    return { ok: false, reason: rec.count >= MAX_FAILS ? "Too many wrong codes — signatures for your account are refused for 15 minutes" : "That code did not match (or was already used) — enter the current one from your authenticator" };
  }
  await kvs.set(lastKey(accountId), { step, at: new Date().toISOString() });
  await kvs.delete(failKey(accountId)).catch(() => {});
  return { ok: true, signature: { method: "totp", verifiedAt: new Date().toISOString(), enrolledAt: s.enrolledAt || null } };
}
