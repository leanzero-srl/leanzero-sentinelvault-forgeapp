// Confluence storage-format comment for Conditions & Validations findings.
import { postCommentWithMention } from "./outbound-notify.js";

const HEADER = "🔒 <strong>Sentinel Vault</strong>";

function escapeXml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function mention(accountId) {
  return `<ac:link><ri:user ri:account-id="${escapeXml(accountId)}" /></ac:link>`;
}

function severityChip(sev) {
  if (sev === "block") return "⛔ <strong>Required</strong>";
  return "⚠️ <strong>Recommended</strong>";
}

/**
 * Build + post a validation-findings footer comment, mentioning the editor.
 */
export async function postValidationComment({ pageId, editorAccountId, violations, reverted, historyUrl }) {
  if (!pageId || !violations || violations.length === 0) return { success: false, reason: "Nothing to report" };

  const items = violations
    .map((v) => `<li>${severityChip(v.severity)} — ${escapeXml(v.label)}: ${escapeXml(v.message)}</li>`)
    .join("");

  const lead = reverted
    ? "Your recent edit did not meet this page's content standards and was reverted to the last compliant version."
    : "Your recent edit does not meet this page's content standards. Please review and update:";

  // Trust: when we reverted, point to where the change can be recovered.
  const recovery = reverted && historyUrl
    ? `<p>Your version is preserved in the page history — <a href="${escapeXml(historyUrl)}">view previous versions</a> to recover it.</p>`
    : "";

  const storageBody = `
<p>${HEADER} — <strong>Content Validation</strong></p>
<p>${editorAccountId ? mention(editorAccountId) + " — " : ""}${escapeXml(lead)}</p>
<ul>${items}</ul>
${recovery}
`.trim();

  return postCommentWithMention({ pageId, storageBody });
}

function aiSevChip(sev) {
  if (sev === "high") return "🔴 <strong>High</strong>";
  if (sev === "medium") return "🟠 <strong>Medium</strong>";
  return "🟡 <strong>Low</strong>";
}

/**
 * Build + post an AI content-review footer comment, mentioning the page author.
 */
export async function postAiFindingsComment({ pageId, recipientAccountId, findings, pageTitle }) {
  if (!pageId || !findings || findings.length === 0) return { success: false, reason: "Nothing to report" };

  const items = findings
    .map((f) => {
      const ref = f.ruleRef ? `${escapeXml(f.ruleRef)} — ` : "";
      const ex = f.excerpt ? ` <em>"${escapeXml(f.excerpt)}"</em>` : "";
      const fix = f.suggestion ? ` <br/>Suggestion: ${escapeXml(f.suggestion)}` : "";
      return `<li>${aiSevChip(f.severity)} ${ref}${escapeXml(f.explanation)}${ex}${fix}</li>`;
    })
    .join("");

  const storageBody = `
<p>${HEADER} — <strong>AI Content Review</strong></p>
<p>${recipientAccountId ? mention(recipientAccountId) + " — " : ""}AI review of <strong>"${escapeXml(pageTitle || "this page")}"</strong> found ${findings.length} item${findings.length > 1 ? "s" : ""} to review:</p>
<ul>${items}</ul>
`.trim();

  return postCommentWithMention({ pageId, storageBody });
}
