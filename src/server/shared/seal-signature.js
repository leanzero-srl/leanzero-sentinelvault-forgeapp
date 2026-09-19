/*
 * Signed seal actions (tester report 2026-09-19: "when I release, give access or decline a
 * request I want to be asked for my authenticator code"). The approval signature (B3) covered
 * workflow decisions only; with the site setting `signSealActions` ON, the actions listed here
 * also demand the caller's current code. ONE home: registry.js wraps these keys, so no resolver
 * carries its own copy of the rule and none can be forgotten.
 *
 * The refusal shape is the one the ribbon already speaks: `{ success:false, signatureRequired:true,
 * reason }` — the surfaces open the code prompt on `signatureRequired` and retry with `code`.
 */
export const SIGNED_SEAL_ACTION_KEYS = Object.freeze([
  "unseal-artifact", "unseal-section", "steward-unseal", "extend-seal",
  "approve-edit-request", "deny-edit-request", "approve-section-edit", "deny-section-edit",
  "grant-edit-access", "grant-section-edit", "revoke-edit-grant", "revoke-section-edit-grant",
]);

/** PURE: does this site sign seal actions? Opt-in. */
export const signSealActionsOn = (globalSettings) => globalSettings?.signSealActions === true;
