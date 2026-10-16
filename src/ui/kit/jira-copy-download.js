/*
 * 8.6 — My work's "Download the copy" for a sealed Jira file whose issue was deleted.
 *
 * Measured on wolfaenpak 2026-10-16: the Forge Object Store's download link answers with
 * Content-Type application/octet-stream (the type the copy was stored with), no Content-Disposition,
 * and a path that is a hash of the key, so the browser saved a file named by that hash with no
 * extension. The store cannot carry a name. So the page reads the copy in parts (`jira-copy-part`,
 * owner-only on the server), joins them, checks the bytes against the SHA-256 taken when the file
 * was sealed, and saves it under the sealed file's own name and type. Works for copies stored before
 * 8.6 too: the name and type come from the seal record, not from the stored object.
 *
 * Pure apart from WebCrypto (present in browsers and in node), so test/jira-seal-flows.test.mjs runs it.
 */

const fromBase64 = (b64) => {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Join the parts and prove they are the sealed file. Returns { ok: true, bytes } or
 * { ok: false, reason } — a wrong or short copy is never handed to the browser to save.
 */
export async function assembleCopy(parts, head) {
  const chunks = (Array.isArray(parts) ? parts : []).map(fromBase64);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (Number.isFinite(Number(head?.size)) && total !== Number(head.size)) {
    return { ok: false, reason: "The copy arrived incomplete. Try again." };
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  if (head?.sha256) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return { ok: false, reason: "This browser cannot check the copy, so it was not saved." };
    const got = hex(await subtle.digest("SHA-256", bytes));
    if (got !== String(head.sha256).toLowerCase()) return { ok: false, reason: "The copy does not match the sealed file, so it was not saved." };
  }
  return { ok: true, bytes };
}
