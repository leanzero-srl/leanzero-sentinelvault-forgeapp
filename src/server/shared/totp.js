// B3: TOTP (RFC 6238 over HOTP RFC 4226), pure, on node's own HMAC — the honest e-signature a
// Forge app can offer: Forge has no re-authentication API, so "prove you hold the enrolled
// device" is the strongest claim we can make, and the only one we make.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(bytes = 20) {
  return base32Encode(randomBytes(bytes));
}

// HOTP: dynamic truncation of HMAC-SHA1(secret, counter).
export function hotp(secretB32, counter, digits = 6) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) { msg[i] = Number(c & 0xffn); c >>= 8n; }
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const timeStep = (nowMs = Date.now(), period = 30) => Math.floor(nowMs / 1000 / period);

export function totp(secretB32, nowMs = Date.now(), { period = 30, digits = 6 } = {}) {
  return hotp(secretB32, timeStep(nowMs, period), digits);
}

// Verify a code within ±window steps. Returns the matched step (for replay refusal) or null.
// `lastStep` — the last step already accepted for this secret — is never accepted again.
export function verifyTotp(secretB32, code, { nowMs = Date.now(), window = 1, period = 30, digits = 6, lastStep = null } = {}) {
  const c = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(c) || c.length !== digits) return null;
  const now = timeStep(nowMs, period);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (lastStep != null && step <= lastStep) continue;
    const expect = hotp(secretB32, step, digits);
    if (expect.length === c.length && timingSafeEqual(Buffer.from(expect), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri({ secret, account, issuer = "Sentinel Vault" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
