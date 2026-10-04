// In-product Documentation and Support links in the Site settings header (2026-10-04).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, ok, report } from "./_assert.mjs";
import { HELP_LINKS, DOCS_URL, SUPPORT_URL } from "../src/ui/kit/help-links.js";

eq("documentation URL", DOCS_URL, "https://leanzero.net/portfolio/sentinel-vault");
eq("support URL", SUPPORT_URL, "https://leanzero.atlassian.net/servicedesk/customer/portal/34");
eq("two links, docs first", HELP_LINKS.map((l) => l.label), ["Documentation", "Support"]);
ok("every link is https", HELP_LINKS.every((l) => l.href.startsWith("https://")));
const here = dirname(fileURLToPath(import.meta.url));
const sc = readFileSync(resolve(here, "../src/ui/surfaces/steward-console/index.jsx"), "utf8");
ok("the site settings header renders them", /HELP_LINKS\.map\(/.test(sc) && sc.indexOf("HELP_LINKS.map(") < sc.indexOf("<LicenseBanner />"));
ok("opened through the Forge router (a sandboxed frame may block a plain link)", /router\.open\(l\.href\)/.test(sc));
const css = readFileSync(resolve(here, "../src/ui/tokens/steward-console.css"), "utf8");
ok("no left accent rail on the links", !/\.sv-help-link[^{]*\{[^}]*border-left/.test(css));
report("help-links");
