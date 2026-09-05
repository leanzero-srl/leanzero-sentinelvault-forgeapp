// RFC 4226 / RFC 6238 test vectors (SHA-1, secret "12345678901234567890"), plus the replay and
// window rules the signature relies on.
import { base32Encode, base32Decode, hotp, totp, verifyTotp, timeStep, generateSecret, otpauthUri } from "../src/server/shared/totp.js";
import { eq, ok, report } from "./_assert.mjs";

const SECRET = base32Encode(Buffer.from("12345678901234567890"));
eq("base32 of the RFC secret", SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
eq("base32 round-trips", base32Decode(SECRET).toString(), "12345678901234567890");
// RFC 4226 Appendix D
eq("HOTP counter 0", hotp(SECRET, 0), "755224");
eq("HOTP counter 1", hotp(SECRET, 1), "287082");
eq("HOTP counter 9", hotp(SECRET, 9), "520489");
// RFC 6238 Appendix B (8 digits, SHA-1): T=59 → 94287082; T=1111111109 → 07081804
eq("TOTP at T=59 (8 digits)", totp(SECRET, 59 * 1000, { digits: 8 }), "94287082");
eq("TOTP at T=1111111109 (8 digits)", totp(SECRET, 1111111109 * 1000, { digits: 8 }), "07081804");
eq("TOTP at T=1234567890 (8 digits)", totp(SECRET, 1234567890 * 1000, { digits: 8 }), "89005924");
eq("6-digit TOTP is the last six", totp(SECRET, 59 * 1000), "287082");

const now = 1234567890 * 1000;
const step = timeStep(now);
ok("the current code verifies", verifyTotp(SECRET, totp(SECRET, now), { nowMs: now }) === step);
ok("the previous step's code verifies (window 1)", verifyTotp(SECRET, hotp(SECRET, step - 1), { nowMs: now }) === step - 1);
ok("the next step's code verifies (window 1)", verifyTotp(SECRET, hotp(SECRET, step + 1), { nowMs: now }) === step + 1);
ok("two steps back does NOT", verifyTotp(SECRET, hotp(SECRET, step - 2), { nowMs: now }) === null);
ok("a wrong code does not", verifyTotp(SECRET, "000000", { nowMs: now }) === null || hotp(SECRET, step) === "000000");
ok("REPLAY: a step already accepted is refused", verifyTotp(SECRET, totp(SECRET, now), { nowMs: now, lastStep: step }) === null);
ok("…and so is any earlier step", verifyTotp(SECRET, hotp(SECRET, step - 1), { nowMs: now, lastStep: step }) === null);
ok("a later step is still fine after an accepted one", verifyTotp(SECRET, hotp(SECRET, step + 1), { nowMs: now, lastStep: step }) === step + 1);
ok("spaces inside the code are tolerated", verifyTotp(SECRET, totp(SECRET, now).replace(/(\d{3})/, "$1 "), { nowMs: now }) === step);
ok("letters are refused", verifyTotp(SECRET, "12a456", { nowMs: now }) === null);
ok("generated secrets are 32 base32 chars (160 bits)", /^[A-Z2-7]{32}$/.test(generateSecret()));
ok("two generated secrets differ", generateSecret() !== generateSecret());
eq("otpauth URI", otpauthUri({ secret: "ABC", account: "m@x.y" }), "otpauth://totp/Sentinel%20Vault%3Am%40x.y?secret=ABC&issuer=Sentinel%20Vault&algorithm=SHA1&digits=6&period=30");
report("totp");
