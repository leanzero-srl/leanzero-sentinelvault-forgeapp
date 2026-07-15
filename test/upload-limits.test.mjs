import { withinUploadSizeLimit, estimateRawBytes, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "../src/server/shared/upload-limits.js";
import { eq, ok, report } from "./_assert.mjs";

// it57: the upload size limit is on the RAW (decoded) bytes, NOT the base64 string length. base64 is
// ~4/3 the raw size, so measuring the string length would reject files ~25% smaller than intended.
eq("MAX is 4 MB", MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
eq("label matches the limit", MAX_UPLOAD_LABEL, "4 MB");

// estimateRawBytes: base64 length → raw bytes (3 raw bytes per 4 base64 chars)
eq("4 base64 chars → 3 raw bytes", estimateRawBytes(4), 3);
eq("empty → 0", estimateRawBytes(0), 0);
eq("garbage → 0", estimateRawBytes("abc"), 0);
eq("negative → 0", estimateRawBytes(-10), 0);

// a base64 string of MAX/0.75 chars decodes to exactly MAX raw → within limit
ok("base64 decoding to exactly 4 MB raw is within the limit", withinUploadSizeLimit(Math.floor(MAX_UPLOAD_BYTES / 0.75)));
// a ~4.5 MB raw file (6 M base64 chars) is rejected
ok("~4.5 MB raw file is rejected", !withinUploadSizeLimit(6 * 1024 * 1024));
// a ~3 MB raw file (4 M base64 chars) is accepted
ok("~3 MB raw file is accepted", withinUploadSizeLimit(4 * 1024 * 1024));
// CRITICAL (the flagged ambiguity): a 4 MB-LONG base64 STRING is only ~3 MB raw and MUST be accepted —
// proving the check measures raw size, not the string length.
ok("a 4 MB base64 STRING (~3 MB raw) is accepted, not measured as its length", withinUploadSizeLimit(MAX_UPLOAD_BYTES));

report("upload-limits");
