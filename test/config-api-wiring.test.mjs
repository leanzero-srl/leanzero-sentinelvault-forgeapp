// Every REST content op must resolve to a handler the config-api dispatcher can reach.
// Guards the 6.4.0 bug: grant/revoke/decline edit ops were accepted by validateBundle but the job
// failed "No resolver" because resolvers.js never imported the editreq capsule. Static (reads the
// sources) because resolvers.js pulls @forge/* and cannot load under plain node.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, report } from "./_assert.mjs";
import { CONTENT_OPS } from "../src/server/capsules/config-api/bundle.js";

const here = dirname(fileURLToPath(import.meta.url));
const cfgDir = resolve(here, "../src/server/capsules/config-api");
const src = readFileSync(resolve(cfgDir, "resolvers.js"), "utf8");
const imports = [...src.matchAll(/import \{ actions as (\w+) \} from "([^"]+)"/g)];
const listed = (src.match(/const lists = \[([^\]]*)\]/) || [, ""])[1].split(",").map((x) => x.trim()).filter(Boolean);
const keys = new Set();
for (const [, name, rel] of imports) {
  eq(`resolvers.js puts ${name} in lists`, listed.includes(name), true);
  const body = readFileSync(resolve(cfgDir, rel), "utf8");
  for (const m of body.matchAll(/\[\s*"([a-z0-9-]+)",\s*\w+\s*\]/g)) keys.add(m[1]);
}
for (const [op, spec] of Object.entries(CONTENT_OPS)) {
  if (!spec.resolverKey) continue;
  eq(`content op "${op}" → resolver "${spec.resolverKey}" is reachable from config-api/resolvers.js`, keys.has(spec.resolverKey), true);
}
report("config-api-wiring");
