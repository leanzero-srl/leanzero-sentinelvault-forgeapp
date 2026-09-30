import { restoredTitle, isNameTakenConflict } from "../src/server/infra/attachment-status.js";
import assert from "node:assert/strict";

assert.equal(restoredTitle("Test sentinel.docx"), "Test sentinel (restored).docx");
assert.equal(restoredTitle("Test sentinel.docx", 2), "Test sentinel (restored 2).docx");
assert.equal(restoredTitle("README"), "README (restored)");
assert.equal(restoredTitle(".env"), ".env (restored)");
assert.equal(restoredTitle("v1.2 release notes"), "v1.2 release notes (restored)");
assert.equal(restoredTitle(""), "Unknown (restored)");
assert.ok(isNameTakenConflict(409, "Cannot restore content with id ContentId{id=1}: newer Content exists in space ~x with title A.docx."));
assert.ok(!isNameTakenConflict(409, "version conflict"));
assert.ok(!isNameTakenConflict(400, "newer Content exists"));
console.log("restored-title: 9 passed");
