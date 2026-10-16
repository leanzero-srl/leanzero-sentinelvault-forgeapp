// A small Confluence the fake runtime can answer from: pages with a version history (author +
// ADF per version), content properties, users (display name, groups, site-admin flag), space
// admins and page readers. Enough of the REST surface for the workflow enforcement paths in
// triggers.js (probe, Pass 0 revert, demote, sweep, guard) and the dispatch resolver.
import { onConfluence } from "./state.mjs";

const doc = (text) => ({ version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

export function createWorld({ appAccountId = "app-account", spaceKey = "WF", spaceId = "9001" } = {}) {
  const pages = new Map(); // id -> { id, title, status, spaceId, versions: [{ number, authorId, adf }], props: Map(key -> { id, version, value }) }
  const users = new Map(); // accountId -> { displayName, groups: [], siteAdmin }
  const spaceAdmins = new Set();
  const readers = new Set(); // accountIds that may read every page ("*" = everyone)
  const comments = [];
  let propSeq = 100;

  const world = {
    appAccountId, spaceKey, spaceId, pages, users, spaceAdmins, readers, comments, doc,
    addUser(accountId, { displayName = accountId, groups = [], siteAdmin = false } = {}) { users.set(accountId, { displayName, groups, siteAdmin }); return world; },
    addPage(id, { title = `Page ${id}`, versions = [] } = {}) {
      pages.set(String(id), { id: String(id), title, status: "current", spaceId, versions: versions.map((v, i) => ({ number: i + 1, authorId: v.authorId, adf: v.adf || doc(v.text || `v${i + 1}`) })), props: new Map() });
      return world;
    },
    /** A human saves a new version (no event fired: the test calls the trigger itself). */
    edit(id, authorId, text) {
      const p = pages.get(String(id));
      p.versions.push({ number: p.versions.length + 1, authorId, adf: doc(text) });
      return p.versions.length;
    },
    live(id) { const p = pages.get(String(id)); return p.versions[p.versions.length - 1]; },
    prop(id, key) { return pages.get(String(id))?.props.get(key)?.value ?? null; },
  };

  const pageJson = (p, v, withBody) => ({
    id: p.id, status: p.status, title: p.title, spaceId: p.spaceId,
    version: { number: v.number, authorId: v.authorId },
    ...(withBody ? { body: { atlas_doc_format: { value: JSON.stringify(v.adf), representation: "atlas_doc_format" } } } : {}),
  });

  onConfluence((method, rawPath, body) => {
    const path = decodeURIComponent(rawPath);
    const [base, qs = ""] = path.split("?");
    const q = Object.fromEntries(qs.split("&").filter(Boolean).map((kv) => { const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)]; }));
    let m;

    if (base === "/wiki/rest/api/user/current") return { body: { accountId: appAccountId } };
    if (base === "/wiki/rest/api/user/memberof") {
      const u = users.get(q.accountId);
      return u ? { body: { results: u.groups.map((name) => ({ name })) } } : { status: 404 };
    }
    if (base === "/wiki/rest/api/user") {
      const u = users.get(q.accountId);
      if (!u) return { status: 404 };
      return { body: { accountId: q.accountId, displayName: u.displayName, publicName: u.displayName, groups: { results: u.groups.map((name) => ({ name })) }, operations: u.siteAdmin ? [{ operation: "administer", targetType: "application" }] : [] } };
    }
    if ((m = base.match(/^\/wiki\/rest\/api\/space\/([^/]+)\/permission\/check$/)) && method === "POST") {
      return { body: { hasPermission: m[1] === spaceKey && spaceAdmins.has(body?.subject?.identifier) } };
    }
    if ((m = base.match(/^\/wiki\/rest\/api\/content\/(\d+)\/permission\/check$/)) && method === "POST") {
      const who = body?.subject?.identifier;
      return { body: { hasPermission: pages.has(m[1]) && (readers.has("*") || readers.has(who)) } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) return m[1] === spaceId ? { body: { id: spaceId, key: spaceKey } } : { status: 404 };

    if (base === "/wiki/api/v2/pages" && method === "GET") {
      const ids = String(q.id || "").split(",");
      const statuses = String(q.status || "current").split(",");
      return { body: { results: ids.map((id) => pages.get(id)).filter((p) => p && statuses.includes(p.status)).map((p) => pageJson(p, p.versions[p.versions.length - 1], false)) } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/versions$/))) {
      const p = pages.get(m[1]);
      if (!p) return { status: 404 };
      const limit = Number(q.limit) || 25;
      return { body: { results: [...p.versions].reverse().slice(0, limit).map((v) => ({ number: v.number, authorId: v.authorId })) } };
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/attachments$/))) return pages.has(m[1]) ? { body: { results: [] } } : { status: 404 };
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)\/properties(?:\/(\d+))?$/))) {
      const p = pages.get(m[1]);
      if (!p) return { status: 404 };
      if (method === "GET") {
        const row = q.key ? p.props.get(q.key) : null;
        return { body: { results: row ? [{ id: row.id, key: q.key, value: row.value, version: { number: row.version } }] : [] } };
      }
      if (method === "POST") { const row = { id: String(++propSeq), version: 1, value: body.value }; p.props.set(body.key, row); return { body: { id: row.id, key: body.key, value: row.value, version: { number: 1 } } }; }
      if (method === "PUT") { const row = [...p.props.values()].find((r) => r.id === m[2]); if (!row) return { status: 404 }; row.value = body.value; row.version += 1; return { body: { id: row.id, value: row.value, version: { number: row.version } } }; }
      if (method === "DELETE") { for (const [k, r] of p.props) if (r.id === m[2]) p.props.delete(k); return { status: 204 }; }
    }
    if ((m = base.match(/^\/wiki\/api\/v2\/pages\/(\d+)$/))) {
      const p = pages.get(m[1]);
      if (!p) return { status: 404 };
      if (method === "GET") {
        const v = q.version ? p.versions.find((x) => x.number === Number(q.version)) : p.versions[p.versions.length - 1];
        if (!v) return { status: 404 };
        return { body: pageJson(p, v, q["body-format"] === "atlas_doc_format") };
      }
      if (method === "PUT") {
        const cur = p.versions.length;
        if (body?.version?.number !== cur + 1) return { status: 409, body: { message: "version conflict" } };
        p.versions.push({ number: cur + 1, authorId: appAccountId, adf: JSON.parse(body.body.value), message: body.version.message });
        return { body: pageJson(p, p.versions[p.versions.length - 1], false) };
      }
    }
    // Comments (any API generation) — recorded, never read back by these paths.
    if (method === "POST" && /comment/i.test(base)) { comments.push({ path: base, body }); return { body: { id: `c${comments.length}` } }; }
    // Labels: accept quietly.
    if (/\/label/.test(base)) return { body: { results: [] } };
    return undefined;
  });

  return world;
}
