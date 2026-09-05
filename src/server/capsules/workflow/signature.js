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
const ENROLL_TTL_MS = 15 * 60 * 1000;

export async function signatureStatus(accountId) {
  if (!accountId) return { enrolled: false, pending: false };
  const s = await kvs.get(secretKey(accountId));
  const p = await kvs.get(enrollKey(accountId));
  return { enrolled: !!s?.secret, enrolledAt: s?.enrolledAt || null, pending: !!p?.secret };
}

// Start (or restart) an enrolment: a fresh secret the user adds to their authenticator. The
// secret leaves the app exactly once, here, so the QR can be drawn client-side (no egress).
export async function startEnrollment(accountId, { accountLabel } = {}) {
  if (!accountId) return { success: false, reason: "No account" };
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

export async function revokeSignature(accountId) {
  if (!accountId) return { success: false, reason: "No account" };
  for (const k of [secretKey(accountId), enrollKey(accountId), lastKey(accountId)]) await kvs.delete(k).catch(() => {});
  return { success: true };
}

// Verify a code for an enrolled account; accepted steps are recorded so no code is reused.
// Returns { ok, reason?, signature? } — `signature` is what a decision record stores.
export async function verifySignature(accountId, code) {
  if (!accountId) return { ok: false, reason: "No account" };
  const s = await kvs.get(secretKey(accountId));
  if (!s?.secret) return { ok: false, reason: "You have not set up an approval signature yet — do that on your My work page first" };
  if (!code) return { ok: false, reason: "Enter the current code from your authenticator to sign this decision" };
  const last = await kvs.get(lastKey(accountId));
  const step = verifyTotp(s.secret, code, { lastStep: typeof last?.step === "number" ? last.step : null });
  if (step == null) return { ok: false, reason: "That code did not match (or was already used) — enter the current one from your authenticator" };
  await kvs.set(lastKey(accountId), { step, at: new Date().toISOString() });
  return { ok: true, signature: { method: "totp", verifiedAt: new Date().toISOString() } };
}
