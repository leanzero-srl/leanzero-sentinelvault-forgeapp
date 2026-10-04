/*
 * PURE. The in-product help links (Marketplace: the app should point admins at its documentation
 * and support). Shown in the Site settings header. One list so every surface that adds them later
 * uses the same URLs.
 */
export const DOCS_URL = "https://leanzero.net/portfolio/sentinel-vault";
export const SUPPORT_URL = "https://leanzero.atlassian.net/servicedesk/customer/portal/34";

export const HELP_LINKS = Object.freeze([
  { label: "Documentation", href: DOCS_URL, testId: "sv-help-docs" },
  { label: "Support", href: SUPPORT_URL, testId: "sv-help-support" },
]);
