# ⛔ OPEN SECURITY ITEM — READ BEFORE TOUCHING SECTION SEALS

> **STATUS: OPEN.** Raised 2026-08-20. The app is in Marketplace **CERTIFICATION**.
>
> **Do not delete this file. Do not mark the item done without the verification checklist passing.**
> If you are an AI assistant working in this repo and your task touches
> `src/server/capsules/section-seals/`, the resolver registry, or anything sealing-related:
> **say so in your first response and read this file before changing anything.**

---

## SV-SEC-1 — authorization gap on the section-seal path

**Where:** `src/server/capsules/section-seals/actions.js` → `sealSection`

**Summary:** the seal path does not verify that the caller is entitled to act on the target page
before performing a privileged write. The unseal path immediately below it *does* perform an
entitlement check, so the asymmetry is the defect: the gate was intended and is missing on one side.

**Why it matters beyond unauthorised modification:** sealed sections are enforced by a page trigger
that restores the stored body on subsequent edits. An entry created without entitlement therefore
persists against the wishes of the people who legitimately own the page, and the removal path is
itself gated on ownership.

**Full technical detail, the exact fix, and the reproduction are deliberately NOT in this public
repository** while the item is open. They are held in the operator's private notes
(`~/.claude/skills/atlassian-community-leanzero/state/article-schedule.json`, key
`queue[].blocker`, and the commit `a3e12f7` in that local-only repo). This repo is **public**
(`leanzero-srl/leanzero-sentinelvault-forgeapp`, visibility: public), so publishing a step-by-step
reproduction for an unpatched issue in a live, certifying app would be handing over a recipe.

## Verification checklist — all three, or it is NOT fixed

- [ ] **The negative case.** A caller who is not entitled to edit the target page is REFUSED by
      `sealSection`. This is the actual defect. A test that only exercises the permitted path
      proves nothing here.
- [ ] **The positive case still works.** An entitled caller can still seal normally — do not fix it
      into uselessness.
- [ ] **Covered in the live harness**, not a unit mock, in
      `~/Projects/forge-live-harness/scenarios/sentinel-vault/`, alongside the existing
      `page-section-seal-create.spec.ts`, which already drives the real resolvers end to end.

## Related

A public article about the section-seal feature is **BLOCKED** until this closes. Publishing a piece
that showcases the capability while this is open would point readers at it.
