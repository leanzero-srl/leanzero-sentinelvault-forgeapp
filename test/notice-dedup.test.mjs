import { decideAnnounce, decideRelease, confirmClaim, decideClear } from "../src/server/shared/notice-dedup.js";
import { composeViolationLayout, composeLapseNoticeLayout, composeAutoReleaseLayout }
  from "../src/server/infra/notice-blueprints.js";
import { eq, ok, report } from "./_assert.mjs";

// F2 (owner feedback 2026-08-27): "I was able to delete a sealed document; after a few second it
// restored but without a specific notification for me or for the owner; it is the same for both
// parties." Two defects behind that sentence — the notice was swallowed, and when it did arrive
// it was one message written about two people rather than to them. Both are covered here.

const OWNER = "712020:owner-aaaa";
const EDITOR = "712020:editor-bbbb";

// ── The dedup decision ────────────────────────────────────────────────────────────────────

// A UI delete of an embedded sealed file fires updated:page AND trashed:attachment. Both land on
// the same marker key. Before this, the second one to arrive was silent — and it was usually the
// trash handler, i.e. the one carrying the news the owner actually wanted.
{
  const first = decideAnnounce(null, "content-removal");
  eq("no marker yet → announce", first.announce, true);
  eq("...and the marker records what was announced", first.marker.outcomes.join(), "content-removal");

  const second = decideAnnounce({ outcomes: ["content-removal"] }, "delete");
  eq("the sibling outcome is NOT swallowed — this is the reported bug", second.announce, true);
  eq("...and both outcomes are now on record",
    second.marker.outcomes.slice().sort().join(), "content-removal,delete");

  eq("the same outcome twice IS swallowed — the incident spam loop stays closed",
    decideAnnounce({ outcomes: ["content-removal", "delete"] }, "delete").announce, false);
  eq("...in either order",
    decideAnnounce({ outcomes: ["delete", "content-removal"] }, "content-removal").announce, false);
}

// Order must not matter: whichever event wins the race, both messages get through exactly once.
{
  const a = decideAnnounce(null, "delete");
  eq("trash handler first → announce", a.announce, true);
  const b = decideAnnounce({ outcomes: a.marker.outcomes }, "content-removal");
  eq("media pass second → still announce", b.announce, true);
  eq("and a third delivery of either is silent",
    decideAnnounce({ outcomes: b.marker.outcomes }, "delete").announce, false);
}

// An install upgrading to F2 holds markers with no outcome list. They must keep blocking, or the
// upgrade emits a burst of comments about violations the users were already told about.
eq("a pre-F2 marker keeps blocking (no catch-up spam on upgrade)",
  decideAnnounce({ at: "2026-08-20T00:00:00.000Z" }, "delete").announce, false);
eq("...even for an outcome it could not have announced",
  decideAnnounce({ at: "2026-08-20T00:00:00.000Z" }, "content-removal").announce, false);
eq("a marker with a non-array outcomes field is treated as legacy, not as empty",
  decideAnnounce({ outcomes: "delete" }, "delete").announce, false);

// ── Release on a failed post ──────────────────────────────────────────────────────────────

// H2-F4/H1-F5: a claimed marker whose comment did not post must be released, or a transient 5xx
// consumes the 24h window and the owner never hears about the tamper.
{
  eq("the only outcome failing → drop the whole marker",
    decideRelease({ outcomes: ["delete"] }, "delete").drop, true);

  const partial = decideRelease({ outcomes: ["content-removal", "delete"] }, "delete");
  eq("one of two failing → keep the marker", partial.drop, false);
  eq("...minus only the outcome that failed", partial.marker.outcomes.join(), "content-removal");

  eq("releasing an outcome that was never claimed leaves the sibling alone",
    decideRelease({ outcomes: ["content-removal"] }, "layout-changed").marker.outcomes.join(), "content-removal");
  eq("a legacy marker is dropped rather than half-edited",
    decideRelease({ at: "x" }, "delete").drop, true);
  eq("no marker at all → drop is a no-op", decideRelease(null, "delete").drop, true);
}

// ── The comment itself: a paragraph per party ─────────────────────────────────────────────

{
  const { storageBody } = composeViolationLayout({
    ownerAccountId: OWNER,
    editorAccountId: EDITOR,
    artifactName: "test1.jpeg",
    pageUrl: "https://example.atlassian.net/wiki/x",
    historyUrl: "https://example.atlassian.net/wiki/history",
    actionVerb: "delete",
  });

  const ownerMentions = storageBody.split(OWNER).length - 1;
  const editorMentions = storageBody.split(EDITOR).length - 1;
  ok("the owner is mentioned", ownerMentions >= 1);
  ok("the editor is mentioned", editorMentions >= 1);
  // The reported complaint: "it is the same for both parties". The editor now has a paragraph
  // addressed to them, which is what makes it two notifications rather than one overheard.
  ok("the editor gets their own addressed paragraph, not just a name-check",
    storageBody.includes(`<p><ac:link><ri:user ri:account-id="${EDITOR}" /></ac:link> —`));
  ok("the owner paragraph says what happened to the file",
    storageBody.includes("restored from the trash"));
  ok("the editor paragraph says what happened to THEIR change",
    storageBody.includes("your deletion was undone"));
  ok("the editor is told where their work went", storageBody.includes("view previous versions"));
  ok("...and how to get access legitimately", storageBody.includes("edit access"));
  eq("two parties → two addressed paragraphs", storageBody.split("<p><ac:link>").length - 1, 2);
}

// Self-inflicted: the owner tripping their own seal must not be addressed twice in one comment.
{
  const { storageBody } = composeViolationLayout({
    ownerAccountId: OWNER, editorAccountId: OWNER,
    artifactName: "a.png", pageUrl: "", historyUrl: "", actionVerb: "edit",
  });
  eq("owner == editor → one paragraph, not two", storageBody.split(OWNER).length - 1, 1);
}

// Vet F4: a purge found by probe has no witnessed editor — state the fact, accuse nobody.
{
  const { storageBody } = composeViolationLayout({
    ownerAccountId: OWNER, editorAccountId: null,
    artifactName: "a.png", pageUrl: "", historyUrl: "", actionVerb: "permanently-deleted",
  });
  // Exactly one addressed paragraph: the owner's. A second `<p>@someone —` would mean the
  // notice invented an accused party out of a probe result.
  eq("no editor → exactly one addressed paragraph",
    storageBody.split("<p><ac:link>").length - 1, 1);
  ok("...and the fact is still stated", storageBody.includes("was permanently deleted"));
}

// Every verb the trigger can raise must produce its own editor line, or a new verb silently
// falls back to the generic "your change was undone" and quietly misdescribes what happened.
for (const verb of ["edit", "delete", "content-removal", "permanently-deleted", "revert-failed", "layout-changed"]) {
  const { storageBody } = composeViolationLayout({
    ownerAccountId: OWNER, editorAccountId: EDITOR,
    artifactName: "f.png", pageUrl: "", historyUrl: "", actionVerb: verb,
  });
  ok(`verb "${verb}" addresses the editor`,
    storageBody.includes(`<p><ac:link><ri:user ri:account-id="${EDITOR}" /></ac:link> —`));
}

// XSS/injection: a filename is user-controlled and lands in Confluence storage XML.
{
  const { storageBody } = composeViolationLayout({
    ownerAccountId: OWNER, editorAccountId: EDITOR,
    artifactName: '<script>alert("x")</script>', pageUrl: "", historyUrl: "", actionVerb: "delete",
  });
  ok("a filename cannot inject markup", !storageBody.includes("<script>"));
  ok("...it is escaped instead", storageBody.includes("&lt;script&gt;"));
}

// ── F5 notice copy ────────────────────────────────────────────────────────────────────────

{
  const { storageBody, summary } = composeLapseNoticeLayout({
    ownerAccountId: OWNER, artifactName: "spec.xlsx", pageTitle: "Home",
    pageUrl: "", expiryDate: "August 18, 2026",
    noticeNumber: 2, noticeLimit: 3, releaseDate: "August 30, 2026",
  });
  ok("the reminder says which one it is", storageBody.includes("reminder 2 of 3"));
  ok("...names the release date, so the outcome is never a surprise",
    storageBody.includes("August 30, 2026"));
  ok("...says what release means", storageBody.includes("available to everyone"));
  ok("...and offers the way out the UI now has", storageBody.includes("Extend it"));
  ok("the summary carries the count too", summary.includes("(2/3)"));
}

{
  const { storageBody } = composeAutoReleaseLayout({
    ownerAccountId: OWNER, artifactName: "spec.xlsx", pageTitle: "Home", pageUrl: "", noticeLimit: 3,
  });
  ok("the release notice says it happened automatically", storageBody.includes("automatically"));
  ok("...after how many reminders", storageBody.includes("3 reminder"));
  ok("...and that the file is available again", storageBody.includes("available to everyone again"));
}


// ── it69: the two races (SECURITY-TODO "Known, pre-existing") ─────────────────────────────

// Race 2 — no CAS: both deliveries read "no marker" and write. The token decides who speaks.
{
  const a = decideAnnounce(null, "layout-changed", "tok-a");
  const b = decideAnnounce(null, "layout-changed", "tok-b");
  eq("both claimers are told to announce by the first read (that is the race)", a.announce && b.announce, true);
  // B's write landed last, so the stored marker carries tok-b.
  eq("A re-reads and finds another token → lost", confirmClaim(b.marker, "layout-changed", "tok-a"), "lost");
  eq("B re-reads and finds its own → held", confirmClaim(b.marker, "layout-changed", "tok-b"), "held");
  eq("a marker with no claims (pre-it69) → clobbered, so the claimer merges and re-confirms",
    confirmClaim({ outcomes: ["layout-changed"] }, "layout-changed", "tok-a"), "clobbered");
  eq("no marker at all → clobbered", confirmClaim(null, "layout-changed", "tok-a"), "clobbered");
}

// F2 must survive the token: two DIFFERENT outcomes racing on one key must both announce.
{
  const del = decideAnnounce(null, "delete", "tok-trash");
  const rem = decideAnnounce(null, "content-removal", "tok-page");   // wrote last → clobbered del
  eq("the trash handler's outcome is gone from the stored marker", confirmClaim(rem.marker, "delete", "tok-trash"), "clobbered");
  const merged = decideAnnounce(rem.marker, "delete", "tok-trash");  // it merges back in
  eq("the merge keeps the sibling's claim", merged.marker.claims["content-removal"], "tok-page");
  eq("...and records its own", merged.marker.claims.delete, "tok-trash");
  eq("after the merge both hold", confirmClaim(merged.marker, "delete", "tok-trash") + "/" + confirmClaim(merged.marker, "content-removal", "tok-page"), "held/held");
  eq("a release drops only its own claim", JSON.stringify(decideRelease(merged.marker, "delete").marker.claims), JSON.stringify({ "content-removal": "tok-page" }));
}

// Race 1 — a late duplicate delivery reads the app's own restore and would "clean-save" the
// marker away. Only a USER's save re-arms the comment.
{
  const APP = "712020:app-0000";
  eq("run that saw a violation never clears (409 twin)", decideClear({ sawViolations: true, readAuthorId: "712020:user", appAccountId: APP }), false);
  eq("body authored by the app → a restore, not a clean save → no clear", decideClear({ sawViolations: false, readAuthorId: APP, appAccountId: APP }), false);
  eq("body authored by a user and clean → clear (re-arm)", decideClear({ sawViolations: false, readAuthorId: "712020:user", appAccountId: APP }), true);
  eq("author unknown → keep the old behaviour (clear)", decideClear({ sawViolations: false, readAuthorId: null, appAccountId: APP }), true);
  eq("app account unresolved → keep the old behaviour (clear)", decideClear({ sawViolations: false, readAuthorId: "x", appAccountId: null }), true);
}

report("notice-dedup");
