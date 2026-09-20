// SEC-9 (UX critique 2026-09-19): the three edit-request notices take `targetKind`, so a section
// owner never reads "your sealed FILE "Decisions"" and a requester never "you can edit this FILE";
// the decline carries the owner's word (SEC-8) and the CTA no longer points at a console tab that
// has no section requests.
import { eq, ok, report } from "./_assert.mjs";
import { composeEditRequestLayout, composeEditApprovedLayout, composeEditDeniedLayout, composeHalfwayLayout, composeExpiryLayout, composeLapseNoticeLayout, composeAutoReleaseLayout } from "../src/server/infra/notice-blueprints.js";

const base = { ownerAccountId: "acc-owner", requesterAccountId: "acc-req", requesterName: "Mihai", artifactName: "Decisions", pageTitle: "Policy", pageUrl: "https://x/wiki/p" };
const text = (l) => l.storageBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

ok("request, attachment (default): 'sealed file'", /your sealed file "Decisions"/.test(text(composeEditRequestLayout(base))));
ok("request, section: 'sealed section'", /your sealed section "Decisions"/.test(text(composeEditRequestLayout({ ...base, targetKind: "section" }))));
ok("request, section: never 'file'", !/\bfile\b/.test(text(composeEditRequestLayout({ ...base, targetKind: "section" }))));
ok("request: the CTA names the panel, the byline and My work — not a console tab", /My work/.test(text(composeEditRequestLayout(base))) && !/space console/.test(text(composeEditRequestLayout(base))));
ok("request: 'decline' is the verb (one verb pair)", /Approve or decline/.test(text(composeEditRequestLayout(base))));
ok("approved, section: 'sealed section' and 'edit this section'", /sealed section "Decisions"/.test(text(composeEditApprovedLayout({ ...base, targetKind: "section" }))) && /edit this section until/.test(text(composeEditApprovedLayout({ ...base, targetKind: "section" }))));
ok("approved, attachment: 'edit this file until'", /edit this file until/.test(text(composeEditApprovedLayout(base))));
ok("denied, section: 'sealed section'", /sealed section "Decisions"/.test(text(composeEditDeniedLayout({ ...base, targetKind: "section" }))));
ok("denied with a reason: the owner's word is in the comment", /The owner said: "not during the freeze"/.test(text(composeEditDeniedLayout({ ...base, reason: "not during the freeze" }))));
ok("denied without a reason: no empty 'The owner said'", !/The owner said/.test(text(composeEditDeniedLayout(base))));
ok("a reason cannot inject markup", !/<script/.test(composeEditDeniedLayout({ ...base, reason: "<script>x</script>" }).storageBody));
eq("summary unchanged", composeEditRequestLayout(base).summary, 'Edit access requested for "Decisions"');

// SEC-7 (d): the expiry sweep's four notices take targetKind too — a section owner never reads "the file".
const exp = { ownerAccountId: "acc-owner", artifactName: "Risks", pageTitle: "Policy", pageUrl: "https://x/wiki/p", expiryDate: "September 22, 2026", releaseDate: "September 25, 2026", noticeNumber: 1, noticeLimit: 3 };
for (const [label, fn] of [["halfway", composeHalfwayLayout], ["expiry", composeExpiryLayout], ["lapse", composeLapseNoticeLayout], ["auto-release", composeAutoReleaseLayout]]) {
  const sec = text(fn({ ...exp, targetKind: "section" }));
  const att = text(fn(exp));
  ok(`${label}, section: says 'section' and never 'file'`, /section "Risks"/.test(sec) && !/\bfile\b/.test(sec));
  ok(`${label}, attachment (default): says 'file'`, /file "Risks"/.test(att));
}
ok("lapse, section: the extend door is the byline's ⋯ → Extend the seal", /⋯ → Extend the seal/.test(text(composeLapseNoticeLayout({ ...exp, targetKind: "section" }))));

report("notice-kinds");
