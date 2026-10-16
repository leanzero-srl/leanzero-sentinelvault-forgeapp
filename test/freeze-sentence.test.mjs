// SEC-2 (d) approval dialog: what approving freezes, and the truth while content protection is off.
import { readFileSync } from "node:fs";
import { freezeSentence } from "../src/ui/kit/freeze-sentence.js";
import { eq, ok, report } from "./_assert.mjs";

const one = { sections: [{ name: "Scope", owner: "Ana" }], attachments: [] };
eq("nothing to freeze → no line", freezeSentence({ sections: [], attachments: [] }), null);
eq("no answer → no line", freezeSentence(null), null);
const on = freezeSentence(one);
ok("protection on: names the section and its owner", /1 sealed section \(Scope — Ana\)/.test(on));
ok("protection on: promises the in-seal edit guard", /nobody outside the approvers can edit inside them/.test(on));
const off = freezeSentence({ ...one, protectionOff: true });
ok("protection off: never promises the in-seal edit guard", !/nobody outside the approvers can edit inside/.test(off));
ok("protection off: custody still stated", /their owners cannot release or extend them until the page leaves Approved/.test(off));
ok("protection off: says edits inside are kept", /protection is switched off on this site, so edits inside them are kept/.test(off));
ok("files counted", /2 sealed files/.test(freezeSentence({ sections: [], attachments: [{ name: "a" }, { name: "b" }] })));
const ribbon = readFileSync(new URL("../src/ui/surfaces/doc-ribbon/index.jsx", import.meta.url), "utf8");
eq("the ribbon composes the line only through freezeSentence", /nobody outside the approvers can edit inside them/.test(ribbon), false);
ok("the ribbon calls freezeSentence", /freezeSentence\(freeze\)/.test(ribbon));
report("freeze-sentence");
