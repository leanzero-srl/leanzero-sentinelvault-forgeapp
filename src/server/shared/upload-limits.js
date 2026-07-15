// it57: the seal-artifact overlay uploads a base64-encoded file, but Confluence's attachment limit is
// on the RAW (decoded) size. base64 encodes 3 raw bytes as 4 chars, so raw ≈ base64.length * 0.75.
// Keeping the limit + the estimate + the user-facing label TOGETHER makes it unambiguous WHICH size is
// measured (raw, not the ~33%-larger base64 string) and keeps the check and the "Maximum size is 4 MB"
// message in sync (resolves the it55 base64-vs-raw edge flagged in the coverage matrix).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB, RAW/decoded
export const MAX_UPLOAD_LABEL = "4 MB";

// estimate the raw (decoded) byte size from a base64 string LENGTH
export function estimateRawBytes(base64Length) {
  const n = Number(base64Length);
  return Number.isFinite(n) && n > 0 ? Math.floor(n * 0.75) : 0;
}

// true iff the decoded file is within the upload limit
export function withinUploadSizeLimit(base64Length) {
  return estimateRawBytes(base64Length) <= MAX_UPLOAD_BYTES;
}
