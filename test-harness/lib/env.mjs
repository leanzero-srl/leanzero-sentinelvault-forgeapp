import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Zero-dependency credential loader (mirrors the CogniRunner / Altomata pattern).
// Reads process.env first, then a local test-harness/.env (gitignored). Never
// commit credentials.
//
// Required:
//   SV_EMAIL  Atlassian account email
//   SV_TOKEN  API token (id.atlassian.com → API tokens)
//   SV_BASE   Confluence base, e.g. https://your-site.atlassian.net/wiki
// Optional:
//   SV_PAGE_ID   an existing page to test against (else create a throwaway)
//   SV_SPACE_KEY space key for throwaway pages

const HARNESS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let cache = null;

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

export function cfg() {
  if (cache) return cache;
  const fileEnv = {};
  const envPath = join(HARNESS_ROOT, ".env");
  if (existsSync(envPath)) Object.assign(fileEnv, parseEnv(readFileSync(envPath, "utf8")));
  const get = (k) => process.env[k] || fileEnv[k];

  const email = get("SV_EMAIL");
  const token = get("SV_TOKEN");
  const base = (get("SV_BASE") || "").replace(/\/$/, "");
  if (!email || !token || !base) {
    throw new Error("Missing SV_EMAIL / SV_TOKEN / SV_BASE (set env vars or test-harness/.env). See test-harness/README.md.");
  }
  cache = {
    email, token, base,
    auth: "Basic " + Buffer.from(`${email}:${token}`).toString("base64"),
    pageId: get("SV_PAGE_ID") || null,
    spaceKey: get("SV_SPACE_KEY") || null,
  };
  return cache;
}
