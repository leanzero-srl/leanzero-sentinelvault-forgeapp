// A seal is filed on the page or blog post its file is attached to — never the page the caller is
// viewing. A file whose own page or blog post is unknown is not sealed.
import "./_forge-fake/install.mjs";
import { eq, ok, report } from "./_assert.mjs";

const { resetFake, onConfluence } = await import("./_forge-fake/state.mjs");
const { kvs } = await import("@forge/kvs");
const sealing = new Map((await import("../src/server/capsules/sealing/actions.js")).actions);
console.warn = () => {}; console.error = () => {}; console.info = () => {};
console.log = ((log) => (...a) => { if (String(a[0] || "").match(/passed|FAIL/)) log(...a); })(console.log);

const USER = "acct-user";
const VIEWED = "5002"; // a page in AAA the user is viewing
const BLOG = "7001"; // a blog post in BBB
const SPACES = { AAA: "101", BBB: "202" };
let writes = [];
function world() {
  resetFake(); writes = [];
  onConfluence((method, rawPath, body) => {
    const [base, query = ""] = decodeURIComponent(rawPath).split("?");
    const qs = new URLSearchParams(query);
    let m;
    if (base === "/wiki/rest/api/user/current") return { body: { accountId: "app-account" } };
    if (base === "/wiki/rest/api/user") return { body: { accountId: qs.get("accountId"), displayName: "User", groups: { results: [] }, operations: [] } };
    if (base === "/wiki/rest/api/user/memberof") return { body: { results: [] } };
    if (/\/permission\/check$/.test(base)) return { body: { hasPermission: true } };
    if (base === `/wiki/api/v2/pages/${VIEWED}`) return { body: { id: VIEWED, status: "current", title: "Viewed page", spaceId: "101", version: { number: 2 } } };
    if (base === `/wiki/api/v2/blogposts/${BLOG}`) return { body: { id: BLOG, status: "current", title: "Blog", spaceId: "202", version: { number: 1 } } };
    if ((m = base.match(/^\/wiki\/api\/v2\/spaces\/(\d+)$/))) { const k = Object.keys(SPACES).find((x) => SPACES[x] === m[1]); return k ? { body: { id: m[1], key: k } } : { status: 404 }; }
    if (base === "/wiki/api/v2/spaces") { const k = qs.get("keys"); return { body: { results: SPACES[k] ? [{ id: SPACES[k], key: k }] : [] } }; }
    if (base === "/wiki/api/v2/attachments/att-blog") return { body: { id: "att-blog", status: "current", title: "blog.pdf", blogPostId: BLOG, fileId: "f-b", version: { number: 1, authorId: USER } } };
    if (base === "/wiki/api/v2/attachments/att-custom") return { body: { id: "att-custom", status: "current", title: "c.pdf", customContentId: "8001", fileId: "f-c", version: { number: 1 } } };
    if (base === "/wiki/api/v2/attachments/att-page") return { body: { id: "att-page", status: "current", title: "p.pdf", pageId: VIEWED, fileId: "f-p", version: { number: 1 } } };
    if ((m = base.match(/^\/wiki\/api\/v2\/(pages|blogposts)\/(\d+)\/properties/))) { if (method !== "GET") writes.push(m[2]); return { body: { results: [] } }; }
    if (method !== "GET") { const id = (base.match(/\/(\d+)(\/|$)/) || [])[1]; if (id) writes.push(id); return { body: {} }; }
    return undefined;
  });
}
const onViewed = { content: { id: VIEWED, space: { key: "AAA", id: "101" } } };
const seal = (attachmentId, ext = onViewed) => sealing.get("seal-artifact")({ payload: { attachmentId }, context: { accountId: USER, extension: ext } });

world();
eq("blog post's file while viewing another page: sealed", (await seal("att-blog"))?.success, true);
eq("blog post's file: filed on the blog post", (await kvs.get("protection-att-blog"))?.contentId, BLOG);
eq("blog post's file: in the blog post's space", (await kvs.get("protection-att-blog"))?.spaceKey, "BBB");
ok("blog post's file: nothing written on the page being viewed", !writes.includes(VIEWED));

world();
eq("file on custom content: refused", (await seal("att-custom"))?.success, false);
ok("file on custom content: no seal", !(await kvs.get("protection-att-custom")));
ok("file on custom content: nothing written on the page being viewed", !writes.includes(VIEWED));

world();
eq("blog post's file with no page context: sealed", (await seal("att-blog", {}))?.success, true);
eq("blog post's file with no page context: filed on the blog post", (await kvs.get("protection-att-blog"))?.contentId, BLOG);

world();
eq("a page's own file (control): sealed", (await seal("att-page"))?.success, true);
eq("a page's own file (control): filed on its page", (await kvs.get("protection-att-page"))?.contentId, VIEWED);

report("seal-container");
