# Sentinel Vault — working notes

<!-- ============================================================================================
     DO NOT REMOVE. This block is the first thing loaded into every AI session in this repo.
     It exists because an open security defect is easy to forget, and the app is in Marketplace
     CERTIFICATION right now.
     ============================================================================================ -->

## ⛔ OPEN SECURITY ITEM — SV-SEC-1 (read `SECURITY-TODO.md` before touching seals)

There is an **open, unfixed authorization gap on the section-seal path** in
`src/server/capsules/section-seals/actions.js`. The seal path does not verify the caller's
entitlement to the target page before a privileged write; the unseal path immediately below it does.
That asymmetry is the defect.

It matters beyond unauthorised modification, because sealed sections are enforced by a page trigger
that restores the stored body on later edits, and the removal path is itself gated on ownership.

**If your task touches section seals, the resolver registry, or anything sealing-related: say so in
your first response before doing anything else.** The verification checklist is in
`SECURITY-TODO.md`, and the item is not fixed until the NEGATIVE case passes — an unentitled caller
being refused. A happy-path test proves nothing here.

Reproduction and the exact fix are held in the operator's private notes rather than in this repo,
because this repository is public and the app is in certification.

Status: OPEN, found 2026-08-20. A public article about this feature is BLOCKED until it closes.

