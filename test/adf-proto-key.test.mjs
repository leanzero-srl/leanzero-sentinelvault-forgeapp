// Content read from Confluence is parsed with JSON.parse, which keeps every object key as an own
// key, including one named "__proto__". The canonical / compare / hash helpers keep every own key,
// so two documents that differ in any key canonicalize and hash differently.
import { eq, ok, report } from "./_assert.mjs";
import { canonicalizeAdf, hashAdf, summarizeAdfDiff } from "../src/server/infra/doc-surgery.js";
import { stableStringify } from "../src/server/capsules/backup/snapshot.js";
import { mergeValidationConfig } from "../src/server/capsules/config-api/pure.js";

const para = (attrs) => JSON.parse(`{"type":"paragraph","attrs":${attrs},"content":[{"type":"text","text":"Approved wording"}]}`);
const plain = para(`{"localId":"a1"}`);
const withProto = para(`{"localId":"a1","__proto__":{"hidden":"changed"}}`);
const withOtherProto = para(`{"localId":"a1","__proto__":{"hidden":"changed again"}}`);
const withStringProto = para(`{"__proto__":"x"}`);

ok("fixture: JSON.parse keeps __proto__ as an own key", Object.prototype.hasOwnProperty.call(withProto.attrs, "__proto__"));
const c = canonicalizeAdf(withProto);
ok("canonical form keeps the own __proto__ key", Object.prototype.hasOwnProperty.call(c.attrs, "__proto__"));
ok("canonical JSON names the __proto__ key", JSON.stringify(c).includes('"__proto__"'));
eq("canonical JSON carries the value hidden in it", JSON.parse(JSON.stringify(c)).attrs.__proto__, { hidden: "changed" });
ok("canonical form is not given a foreign prototype", Object.getPrototypeOf(c.attrs) === Object.prototype && c.attrs.hidden === undefined);
ok("a document with a __proto__ key canonicalizes differently from one without", JSON.stringify(canonicalizeAdf(withProto)) !== JSON.stringify(canonicalizeAdf(plain)));
ok("…and hashes differently", hashAdf(withProto) !== hashAdf(plain));
ok("two different values under __proto__ hash differently", hashAdf(withProto) !== hashAdf(withOtherProto));
ok("a non-object value under __proto__ is kept too", JSON.stringify(canonicalizeAdf(withStringProto)).includes('"__proto__":"x"'));
ok("a __proto__ key nested in content is kept", hashAdf({ type: "doc", content: [withProto] }) !== hashAdf({ type: "doc", content: [plain] }));
eq("the change summary sees a change hidden in __proto__", summarizeAdfDiff([plain], [withProto]).changedBlocks, 1);
// Unchanged behaviour: volatile keys still dropped, key order still irrelevant.
eq("localId still dropped, key order still irrelevant", hashAdf(para(`{"b":1,"a":2,"localId":"x"}`)), hashAdf(para(`{"a":2,"b":1,"localId":"y"}`)));
eq("same document hashes the same (with __proto__)", hashAdf(withProto), hashAdf(para(`{"__proto__":{"hidden":"changed"},"localId":"zz"}`)));

// Siblings: the backup digest walks keys without copying; the config merge copies onto a new object.
ok("backup stableStringify keeps the key", stableStringify(JSON.parse('{"a":{"__proto__":{"x":1}}}')).includes('"__proto__"'));
const merged = mergeValidationConfig({ enabled: true }, JSON.parse('{"__proto__":{"injected":true},"mode":"warn"}'));
ok("validation config merge: no foreign prototype", Object.getPrototypeOf(merged) === Object.prototype && merged.injected === undefined);
ok("validation config merge: the key stays an own key", Object.prototype.hasOwnProperty.call(merged, "__proto__"));
eq("validation config merge: the other keys merge as before", [merged.enabled, merged.mode], [true, "warn"]);

report("adf-proto-key");
