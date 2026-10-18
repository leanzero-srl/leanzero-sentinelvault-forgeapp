/**
 * The two version numbers of an Approved page, and what each one means (2026-10-18, content pilot B2).
 *
 *   reviewedVersion  the version the approvers APPROVED: the approval record's pin (record.approvalRecord.
 *                    pinnedVersion), or the baseline for a record made before pins existed. The truth for
 *                    "who approved which version". The chip, the banner and the audit read it.
 *   baselineVersion  record.approvedVersion: the ENFORCEMENT baseline. It moves forward on every write the
 *                    app or a privileged person makes on the Approved page (logic.js restampApprovedVersion;
 *                    enforce-rules.js eventPredatesBaseline), so after an automatic revert it is the app's
 *                    own write, or that write's version event would look like a new edit.
 *
 * The internal field keeps its name (approvedVersion is read in ~150 places as the baseline). Every
 * surface that SHOWS the baseline goes through describeBaseline, which says why it moved — and never
 * credits an approver with the app's own revert, the defect this module replaces ("Approved content was
 * last updated by an approver or space admin in v9" printed for a revert).
 *
 * record.baselineSource (written by restampApprovedVersion from nextBaselineSource):
 *   { kind, contentOf, editedIn, at }
 *   kind      "restored"  the app wrote a copy of an earlier version after an unapproved edit
 *             "unchanged" a new version with no content change (the baseline advanced, nothing written)
 *             "edit"      an approver or space admin saved a new version (a sanctioned edit)
 *             "seal"      a seal was added to the Approved page (an app write that keeps the seal)
 *             "healed"    a missing baseline was set from the live version (no claim about who)
 *   contentOf the version whose CONTENT the baseline holds (a revert's copy of v7 holds v7)
 *   editedIn  the version of the last sanctioned edit the content carries, or null
 *
 * Zero imports: the UI bundles read it too (the ribbon, the details modal).
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * PURE. How every surface names what a revert gave back (the activity row, the editor's comment, the
 * banner pill): "approved v7" when it is the approved content, else "v8, the last version kept after
 * approval v7" (an approver's or space admin's later save). null when nothing is known.
 */
export function restoredLabel(contentOf, reviewedVersion) {
  const c = num(contentOf);
  const r = num(reviewedVersion);
  if (c == null) return null;
  return r == null || c === r ? `approved v${c}` : `v${c}, the last version kept after approval v${r}`;
}

/** PURE. The version that was approved (what the chip says): the approval record's pin, else the
 *  version the page entered the enforce state at (8.11.0 records), else — a record from before
 *  either — the baseline itself. */
export function reviewedVersionOf(record) {
  if (!record) return null;
  return num(record.approvalRecord?.pinnedVersion) ?? num(record.reviewedVersion) ?? num(record.approvedVersion);
}

/**
 * PURE. What a revert to version `from` gives back, judged on the record AS THE REVERT READ IT (the
 * baseline can move while the revert runs — a sanctioned save in a concurrent run — and what was
 * restored is what was read). Restoring the baseline carries its content forward; restoring a later
 * sanctioned edit (Pass 0's highestSanctionedVersion) restores that edit's own content.
 * @returns {{ contentOf: number|null, editedIn: number|null }}
 */
export function restoredContentOf(record, from) {
  const baseline = num(record?.approvedVersion);
  const f = num(from) ?? baseline;
  if (f == null) return { contentOf: null, editedIn: null };
  if (f === baseline) return { contentOf: num(record?.baselineSource?.contentOf) ?? baseline, editedIn: num(record?.baselineSource?.editedIn) };
  return { contentOf: f, editedIn: f };
}

/**
 * PURE. The baselineSource a re-stamp to version `n` leaves behind, from the record BEFORE the re-stamp.
 * @param {object} record  the workflow record as it is now (approvedVersion = the old baseline)
 * @param {number} n       the new baseline
 * @param {{ kind: string, from?: number|null }} cause  `from` = the version a revert restored
 */
export function nextBaselineSource(record, n, cause, nowIso = new Date().toISOString()) {
  const kind = cause?.kind;
  if (!kind) return null;
  const prevBaseline = num(record?.approvedVersion);
  const prevSrc = record?.baselineSource || null;
  // What the old baseline holds: its own source says, or (no source: it is the approval itself, or a
  // record made before this release) its own version.
  const prevContent = num(prevSrc?.contentOf) ?? prevBaseline;
  const prevEdited = num(prevSrc?.editedIn);
  if (kind === "restored") {
    // The revert says what it restored (restoredContentOf on the record it read): trust that over the
    // record now, which a concurrent re-stamp may have moved.
    if (num(cause.contentOf) != null) return { kind, contentOf: num(cause.contentOf), editedIn: num(cause.editedIn), at: nowIso };
    const from = num(cause.from) ?? prevBaseline;
    // Restoring the baseline itself carries its content forward; restoring a later sanctioned edit
    // (Pass 0's highestSanctionedVersion) restores that edit's own content.
    if (from === prevBaseline) return { kind, contentOf: prevContent ?? n, editedIn: prevEdited, at: nowIso };
    return { kind, contentOf: from, editedIn: from, at: nowIso };
  }
  // An unchanged version equal to a LATER sanctioned edit (the sweep's or Pass 0's target above the
  // baseline) holds that edit's content: the caller says so in cause.contentOf (review 2026-10-18).
  if (kind === "unchanged") {
    if (num(cause.contentOf) != null) return { kind, contentOf: num(cause.contentOf), editedIn: num(cause.editedIn), at: nowIso };
    return { kind, contentOf: prevContent ?? n, editedIn: prevEdited, at: nowIso };
  }
  // A privileged save the app then saved again (its seals restored) holds the editor's change in the
  // app's version n: the edit was made in cause.editedIn, never in the app's n.
  if (kind === "edit") return { kind, contentOf: n, editedIn: num(cause.editedIn) ?? n, at: nowIso };
  if (kind === "seal" || kind === "healed") return { kind, contentOf: n, editedIn: null, at: nowIso };
  return null;
}

/**
 * PURE. A record written before baselineSource existed: the page's own activity rows can still say
 * what the app did at the baseline version (a `workflow.enforced` revert row is filed AT the version
 * the app wrote, with `restoredTo` = the version it restored). Followed back through earlier reverts
 * so a copy of a copy still names the original. null = nothing on record.
 */
export function legacySourceFrom(record, activity) {
  const rows = Array.isArray(activity) ? activity.filter((e) => e?.type === "workflow.enforced" && e?.details?.mode === "revert") : [];
  const at = (v) => rows.find((e) => num(e.version) === v || (e.details?.reconciled === "baseline-advanced" && num(e.details?.driftedVersion) === v));
  const b = num(record?.approvedVersion);
  const first = b != null ? at(b) : null;
  if (!first) return null;
  const kind = first.details?.reconciled === "baseline-advanced" ? "unchanged" : "restored";
  let content = kind === "unchanged" ? num(first.details?.approvedVersion) : num(first.details?.restoredTo);
  const reviewed = reviewedVersionOf(record);
  // Walk back through copies of copies — never past this approval's own version (an earlier approval
  // cycle's rows describe content this approval replaced).
  for (let i = 0; content != null && content !== reviewed && i < 5; i++) {
    const earlier = at(content);
    if (!earlier || earlier === first) break;
    const next = earlier.details?.reconciled === "baseline-advanced" ? num(earlier.details?.approvedVersion) : num(earlier.details?.restoredTo);
    if (next == null || next >= content) break;
    content = next;
  }
  return content == null ? null : { kind, contentOf: content, editedIn: null, at: first.ts || null, inferred: true };
}

/**
 * PURE. What every surface says about the baseline.
 * @returns {{ reviewedVersion, baselineVersion, moved, kind, contentOf, sentence, short }}
 *   sentence  the banner's / API's line (null when the baseline is the reviewed version)
 *   short     the details modal's meta item
 */
export function describeBaseline(record, { activity } = {}) {
  const reviewedVersion = reviewedVersionOf(record);
  const baselineVersion = num(record?.approvedVersion);
  const moved = baselineVersion != null && reviewedVersion != null && baselineVersion !== reviewedVersion;
  const out = { reviewedVersion, baselineVersion, moved, kind: null, contentOf: null, sentence: null, short: null };
  if (!moved) return out;
  const src = record?.baselineSource?.kind ? record.baselineSource : legacySourceFrom(record, activity);
  const b = baselineVersion;
  const r = reviewedVersion;
  const c = num(src?.contentOf);
  const kind = src?.kind || null;
  out.kind = kind;
  out.contentOf = c;
  const ofWhat = (v) => (v === r ? `approved v${r}` : `v${v}`);
  const editNote = (v) => (v != null && v !== r && num(src?.editedIn) === v ? ` (v${v} was saved by an approver or space admin)` : "");
  if (kind === "restored" && c != null) {
    out.sentence = `v${b} is a copy of ${ofWhat(c)} that Sentinel Vault restored after an unapproved edit${editNote(c)}.`;
    out.short = `v${b}: restored copy of v${c}`;
  } else if (kind === "unchanged" && c != null) {
    out.sentence = `v${b} has the same content as ${ofWhat(c)}${editNote(c)}.`;
    out.short = `v${b}: same content as v${c}`;
  } else if (kind === "edit") {
    const e = num(src?.editedIn) ?? b;
    out.sentence = e === b
      ? `Approved content was last updated by an approver or space admin in v${b}.`
      : `Approved content was last updated by an approver or space admin in v${e}; v${b} is Sentinel Vault's save of it with the page's seals restored.`;
    out.short = `v${e}: updated by an approver or space admin`;
  } else if (kind === "seal") {
    out.sentence = `Changes after approval are checked against v${b}, saved when a seal was added to the page.`;
    out.short = `Checked against v${b} (a seal was added)`;
  } else {
    // A record from before this release with nothing on record, or a healed baseline: say what the
    // app compares against, and name nobody.
    out.sentence = `Changes after approval are checked against v${b}.`;
    out.short = `Checked against v${b}`;
  }
  return out;
}

/** PURE. The fields the content property and the API answers carry, named for what they mean. */
export function baselineFields(record, opts) {
  const d = describeBaseline(record, opts);
  return { reviewedVersion: d.reviewedVersion, baselineVersion: d.baselineVersion, baselineKind: d.kind, baselineContentOf: d.moved ? d.contentOf : d.reviewedVersion };
}
