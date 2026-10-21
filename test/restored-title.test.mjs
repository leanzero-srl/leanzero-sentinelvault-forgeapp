import { isNameTakenConflict, fileIdAnswer } from "../src/server/infra/attachment-status.js";
import assert from "node:assert/strict";

// A restore Confluence refuses because a newer file holds the name (409 "newer Content exists").
assert.ok(isNameTakenConflict(409, "Cannot restore content with id ContentId{id=1}: newer Content exists in space ~x with title A.docx."));
assert.ok(!isNameTakenConflict(409, "version conflict"));
assert.ok(!isNameTakenConflict(400, "newer Content exists"));
// The fileId of an attachment version: a busy answer is not an answer.
assert.deepEqual(fileIdAnswer(200, { fileId: "f1" }), { fileId: "f1", busy: false });
assert.deepEqual(fileIdAnswer(200, {}), { fileId: null, busy: false });
assert.deepEqual(fileIdAnswer(404, null), { fileId: null, busy: false });
assert.deepEqual(fileIdAnswer(429, null), { fileId: null, busy: true });
assert.deepEqual(fileIdAnswer(503, null), { fileId: null, busy: true });
console.log("restored-title: 8 passed");
