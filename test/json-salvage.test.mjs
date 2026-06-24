import { parseAIJson } from "../src/server/infra/json-salvage.js";
import { eq, ok, report } from "./_assert.mjs";

// Clean JSON
eq("clean object", parseAIJson('{"a":1,"b":"x"}'), { a: 1, b: "x" });
eq("clean array", parseAIJson('[1,2,3]'), [1, 2, 3]);

// Markdown fences
eq("```json fence", parseAIJson('```json\n{"ok":true}\n```'), { ok: true });
eq("plain ``` fence", parseAIJson('```\n{"ok":true}\n```'), { ok: true });

// Prose wrapping
eq("prose around object", parseAIJson('Sure! Here is the result:\n{"findings":[]}\nHope that helps.'), { findings: [] });

// Truncated object (model hit token budget)
const t = parseAIJson('{"isValid": false, "reason": "the version tag and');
ok("truncated recovers isValid", t && t.isValid === false);
ok("truncated keeps partial reason", t && typeof t.reason === "string");

// Unescaped inner quotes
const q = parseAIJson('{"reason": "a tag "v1" appears"}');
ok("unescaped quotes recovered", q && typeof q.reason === "string" && q.reason.includes("v1"));

// Non-JSON / empty
eq("null input", parseAIJson(null), null);
eq("empty string", parseAIJson(""), null);
eq("no json at all", parseAIJson("just some prose, no braces"), null);

report("json-salvage");
