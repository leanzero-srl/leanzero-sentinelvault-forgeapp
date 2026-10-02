/*
 * Backup — REST body validation for the config-api backup ops (PURE; the static trigger imports
 * only this, so the web trigger never loads the capsule graph). Ops and bodies: rest.js.
 */
import { BACKUP_OPS } from "../config-api/admission.js";

const isId = (v) => typeof v === "string" ? /^\d{1,20}$/.test(v) : Number.isInteger(v) && v > 0;
const isAttId = (v) => typeof v === "string" && /^(att)?\d{1,20}$/.test(v);

/** PURE. { ok, errors[] } for an op's body. */
export function validateBackupOp(op, body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  const errors = [];
  if (!BACKUP_OPS.includes(op)) errors.push(`unknown op ${op}`);
  if (b === null && body != null && body !== "") errors.push("body must be a JSON object");
  const v = b || {};
  if (v.receiptPageId != null && !isId(String(v.receiptPageId))) errors.push("receiptPageId must be a page id");
  switch (op) {
    case "restore":
      if (v.pageId != null && !isId(String(v.pageId))) errors.push("pageId must be a page id");
      if (v.generationId != null && !/^[A-Za-z0-9-]{6,64}$/.test(String(v.generationId))) errors.push("generationId is malformed");
      if (v.preview != null && typeof v.preview !== "boolean") errors.push("preview must be true or false");
      break;
    case "export":
      if (!isId(String(v.pageId ?? ""))) errors.push("export needs pageId: a page you can edit, where the export file is attached");
      break;
    case "import":
      if (!isId(String(v.pageId ?? ""))) errors.push("import needs pageId");
      if (!isAttId(String(v.attachmentId ?? ""))) errors.push("import needs attachmentId (the export file attached to that page)");
      if (v.restore != null && typeof v.restore !== "boolean") errors.push("restore must be true or false");
      break;
    case "resume-automations":
      if (v.ids != null && !(Array.isArray(v.ids) && v.ids.every((x) => typeof x === "string"))) errors.push("ids must be a list of strings");
      break;
    case "backup-location":
      if (!/^[A-Za-z0-9~_.-]{1,255}$/.test(String(v.spaceKey ?? ""))) errors.push("backup-location needs spaceKey");
      break;
    default:
      break;
  }
  return { ok: errors.length === 0, errors };
}

