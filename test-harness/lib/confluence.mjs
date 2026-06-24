import { cfg } from "./env.mjs";

// Live Confluence REST client with retry/backoff. Black-box: drives the same
// endpoints a user/admin would; never imports the app or KVS.

const MAX_RETRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function request(method, path, opts = {}) {
  const C = cfg();
  const url = path.startsWith("http") ? path : `${C.base}${path}`;
  const headers = { Authorization: C.auth, Accept: "application/json", ...(opts.headers || {}) };
  let body = opts.body;
  if (body !== undefined && typeof body !== "string") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = JSON.stringify(body);
  }

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (err) {
      if (attempt > MAX_RETRIES) throw err;
      await sleep(Math.min(30000, 500 * 2 ** (attempt - 1)));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
      const ra = parseInt(res.headers.get("Retry-After") || "", 10);
      await sleep(Number.isFinite(ra) ? ra * 1000 : Math.min(30000, 500 * 2 ** (attempt - 1)));
      continue;
    }
    const text = await res.text();
    if (opts.raw) return { status: res.status, ok: res.ok, text };
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text }; }
    if (!res.ok) {
      const err = new Error(`Confluence ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }
}

export const get = (p, o) => request("GET", p, o);
export const post = (p, b, o) => request("POST", p, { ...o, body: b });
export const put = (p, b, o) => request("PUT", p, { ...o, body: b });
export const del = (p, o) => request("DELETE", p, o);

export async function currentUser() {
  return get("/rest/api/user/current");
}

export async function readPageAdf(pageId) {
  return get(`/api/v2/pages/${pageId}?body-format=atlas_doc_format`);
}

export async function listAttachments(pageId) {
  return get(`/api/v2/pages/${pageId}/attachments`);
}
