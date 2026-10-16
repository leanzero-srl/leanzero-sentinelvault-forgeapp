/*
 * SEC-2 (d): the approval dialog's sentence about what approving freezes. PURE, zero imports —
 * test/freeze-sentence.test.mjs. `freeze` is the `workflow-seals-to-freeze` answer:
 * { sections: [{ name, owner }], attachments: [{ name, owner }], protectionOff }.
 *
 * Custody (owners cannot release or extend a held seal) holds whatever the site settings say, but
 * the undo of an edit INSIDE a sealed section or file is the page-body guard, which the site switch
 * "Protect Sealed Attachments in Page Body" turns off (enforce-rules.js contentProtectionEnabled).
 * Until 2026-10-16 the sentence promised that undo in that state too.
 */
export function freezeSentence(freeze) {
  if (!freeze) return null;
  const secs = Array.isArray(freeze.sections) ? freeze.sections : [];
  const atts = Array.isArray(freeze.attachments) ? freeze.attachments : [];
  if (!secs.length && !atts.length) return null;
  const part = (n, word, list) => `${n} sealed ${word}${n === 1 ? "" : "s"}${list.length ? ` (${list.slice(0, 3).map((x) => `${x.name || "untitled"}${x.owner ? ` — ${x.owner}` : ""}`).join("; ")}${list.length > 3 ? "; …" : ""})` : ""}`;
  const what = [secs.length ? part(secs.length, "section", secs) : "", atts.length ? part(atts.length, "file", atts) : ""].filter(Boolean).join(" and ");
  if (freeze.protectionOff === true) {
    return `Approving freezes this page, including ${what} — their owners cannot release or extend them until the page leaves Approved. Approved-page protection is switched off on this site, so edits inside them are kept.`;
  }
  return `Approving freezes this page, including ${what} — their owners cannot release or extend them and nobody outside the approvers can edit inside them until the page leaves Approved.`;
}
