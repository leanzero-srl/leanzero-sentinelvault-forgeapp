// A small in-memory Forge for flow tests: KVS, the Jira REST calls the Jira-seal code makes, the
// Object Store and the fetch it uses for copies. @forge/kvs, @forge/api's default export and
// @forge/object-store expose plain mutable objects, so the REAL modules are patched in place and the
// app code under test runs unchanged. Anything not modelled answers 404 / throws, never "ok".
import { kvs } from "@forge/kvs";
import api from "@forge/api";
import { objectStore } from "@forge/object-store";
import { createHash } from "node:crypto";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const pathOf = (p) => String(p?.value ?? p?.value_ ?? p);
const res = (status, body, headers = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? "" : typeof body === "string" ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)),
    text: async () => buf.toString("utf8"), json: async () => JSON.parse(buf.toString("utf8")),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
  };
};

export function installFakeForge({ appAccountId = "712020:app" } = {}) {
  const store = new Map();
  const objects = new Map(); // key -> { bytes, contentType }
  const issues = new Map(); // id -> { id, key, project, attachments: [{ id, filename, size, mimeType, bytes, author, created }] }
  const comments = [];
  const users = new Map();
  let nextAtt = 90000;
  let callerPerms = {};

  kvs.get = async (k) => clone(store.get(k));
  kvs.set = async (k, v, opts) => {
    if (opts?.keyPolicy === "FAIL_IF_EXISTS" && store.has(k)) throw new Error("key exists");
    store.set(k, clone(v));
  };
  kvs.delete = async (k) => { store.delete(k); };
  kvs.query = () => {
    let prefix = "", limit = 100, from = 0;
    const q = {
      where: (_f, cond) => { prefix = cond?.values?.[0] || ""; return q; },
      limit: (n) => { limit = n; return q; },
      cursor: (c) => { from = Number(c) || 0; return q; },
      getMany: async () => {
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
        const page = keys.slice(from, from + limit);
        return { results: page.map((key) => ({ key, value: clone(store.get(key)) })), nextCursor: from + limit < keys.length ? String(from + limit) : undefined };
      },
    };
    return q;
  };

  const jira = async (p, init = {}) => {
    const path = pathOf(p);
    const method = (init.method || "GET").toUpperCase();
    let m;
    if ((m = path.match(/^\/rest\/api\/3\/issue\/(\d+)\?fields=/)) && method === "GET") {
      const i = issues.get(m[1]);
      if (!i) return res(404, { errorMessages: ["Issue does not exist"] });
      return res(200, { id: i.id, key: i.key, fields: { summary: "s", project: i.project,
        attachment: i.attachments.map((a) => ({ id: a.id, filename: a.filename, size: a.size, mimeType: a.mimeType, created: a.created, author: { accountId: a.author } })) } });
    }
    if ((m = path.match(/^\/rest\/api\/3\/issue\/(\d+)\/attachments$/)) && method === "POST") {
      const i = issues.get(m[1]);
      if (!i) return res(404, "gone");
      const body = Buffer.from(init.body);
      const head = body.indexOf("\r\n\r\n");
      const name = /filename="([^"]*)"/.exec(body.subarray(0, head).toString("utf8"))[1];
      const type = /Content-Type: ([^\r]+)/.exec(body.subarray(0, head).toString("utf8"))[1];
      const boundary = String(init.headers["Content-Type"]).split("boundary=")[1];
      const bytes = body.subarray(head + 4, body.length - Buffer.byteLength(`\r\n--${boundary}--\r\n`));
      const a = { id: String(nextAtt++), filename: name, size: bytes.length, mimeType: type, bytes, author: appAccountId, created: new Date().toISOString() };
      i.attachments.push(a);
      return res(200, [{ id: a.id, filename: a.filename, size: a.size }]);
    }
    if ((m = path.match(/^\/rest\/api\/3\/attachment\/content\/(\d+)/))) {
      for (const i of issues.values()) { const a = i.attachments.find((x) => x.id === m[1]); if (a) return res(200, a.bytes); }
      return res(404, "no");
    }
    if ((m = path.match(/^\/rest\/api\/3\/issue\/(\d+)\/comment$/)) && method === "POST") {
      if (!issues.has(m[1])) return res(404, "gone");
      comments.push({ issueId: m[1], body: JSON.parse(init.body).body });
      return res(201, { id: String(comments.length) });
    }
    if (/\/properties\//.test(path)) return res(method === "DELETE" ? 204 : 200, "");
    if (path === "/rest/api/3/myself") return res(200, { accountId: appAccountId });
    if ((m = path.match(/^\/rest\/api\/3\/user\?accountId=(.+)$/))) return users.has(decodeURIComponent(m[1])) ? res(200, { displayName: users.get(decodeURIComponent(m[1])) }) : res(404, "");
    if (path.startsWith("/rest/api/3/mypermissions")) return res(200, { permissions: callerPerms });
    return res(404, `fake jira: ${method} ${path} not modelled`);
  };
  api.asApp = () => ({ requestJira: jira, requestConfluence: async () => res(404, "") });
  api.asUser = () => ({ requestJira: jira, requestConfluence: async () => res(404, "") });

  const osUrl = (key, op) => `https://fake-os.test/${op}/${encodeURIComponent(key)}`;
  objectStore.createUploadUrl = async ({ key }) => ({ url: osUrl(key, "up") });
  objectStore.createDownloadUrl = async (key) => (objects.has(key) ? { url: osUrl(key, "down") } : undefined);
  objectStore.createPublicDownloadUrl = async (key) => (objects.has(key) ? { url: osUrl(key, "down") } : undefined);
  objectStore.get = async (key) => {
    const o = objects.get(key);
    return o ? { key, size: o.bytes.length, checksum: createHash("sha256").update(o.bytes).digest("base64"), contentType: o.contentType } : undefined;
  };
  objectStore.delete = async (key) => { objects.delete(key); };
  const fetches = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.split("/").slice(2).join("/"));
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    fetches.push({ op: u.pathname.split("/")[1], key, headers });
    if (u.pathname.startsWith("/up/") && init.method === "PUT") { objects.set(key, { bytes: Buffer.from(init.body), contentType: headers["content-type"] }); return res(201, ""); }
    if (u.pathname.startsWith("/down/")) {
      const o = objects.get(key);
      if (!o) return res(404, "");
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.range || "");
      if (range) return res(206, o.bytes.subarray(Number(range[1]), Number(range[2]) + 1), { "content-type": o.contentType });
      return res(200, o.bytes, { "content-type": o.contentType });
    }
    return res(404, "");
  };

  return {
    store, objects, issues, comments, users, fetches,
    setCallerPermissions: (p) => { callerPerms = p; },
    addIssue: (id, key, projectId = "12587") => { const i = { id, key, project: { id: projectId, key: key.split("-")[0], name: "P" }, attachments: [] }; issues.set(id, i); return i; },
    attach: (issueId, { id, filename, bytes, mimeType = "application/octet-stream", author = "712020:someone" }) => {
      const a = { id: String(id), filename, size: bytes.length, mimeType, bytes: Buffer.from(bytes), author, created: new Date().toISOString() };
      issues.get(issueId).attachments.push(a);
      return a;
    },
    detach: (issueId, attId) => { const i = issues.get(issueId); i.attachments = i.attachments.filter((a) => a.id !== String(attId)); },
    activity: (prefix = "activity-issue-") => [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v).sort((a, b) => String(a.ts).localeCompare(String(b.ts))),
  };
}
