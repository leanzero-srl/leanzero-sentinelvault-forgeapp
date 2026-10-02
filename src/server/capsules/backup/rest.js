/*
 * Backup — the REST doors (config-api ops; docs/REST-CONFIG-API.md "Backup and restore").
 * The static trigger accepts the op (admin role, minter still a site admin), the config-api
 * consumer runs it here through the SAME engine the console uses, and the receipt — the job row
 * `api-job-<tokenId>:<key>`, mirrored to the receipt page when one is named — carries the result.
 *
 *   backup              {}                                       take a backup now
 *   rediscover          {}                                       list every backup page + generations
 *   restore             { pageId?, generationId?, preview? }     preview or restore (default: newest own)
 *   export              { pageId }                               attach the export file to a page YOU can edit
 *   import              { pageId, attachmentId, restore? }       import an export file attached to a page you can read
 *   resume-automations  { ids? }                                 turn paused automations back on
 *   backup-location     { spaceKey }                             move the backup page to another space
 * Every op also takes `receiptPageId` (a page the minter can edit): the receipt, with these
 * details, is mirrored onto it as the content property `sentinel-vault-receipt`.
 */
import { canEditPage, canReadPage } from "../../shared/content-access.js";
import { invoke as invokeResolver } from "../config-api/resolvers.js";
import * as store from "./store.js";
import { discoverBackups, previewGeneration, exportGeneration, resumePaused, loadManifest } from "./engine.js";
import { executeJob, audit } from "./worker.js";

import { BACKUP_OPS } from "../config-api/admission.js";
export { BACKUP_OPS };
export { validateBackupOp } from "./rest-validate.js";

/** Run one op as the token's minter. Returns { status, ...details } for the receipt. */
export async function runBackupOp(op, body, accountId) {
  const v = body || {};
  switch (op) {
    case "backup": {
      const job = { id: "rest", kind: "backup", actor: accountId, payload: { reason: "rest" } };
      const r = await executeJob(job);
      return r.ok ? { status: "done", generationId: r.generationId, keys: r.keys, bytes: r.bytes, unchanged: !!r.unchanged } : { status: "failed", reason: r.reason };
    }
    case "rediscover": {
      const d = await discoverBackups();
      return { status: "done", backups: d.backups.map((b) => ({ pageId: b.pageId, spaceKey: b.spaceKey, sameEnvironment: b.sameEnvironment, generations: b.generations.map((g) => ({ generationId: g.generationId, createdAt: g.createdAt, keys: g.keys, bytes: g.bytes, installationId: g.installationId, reason: g.reason })) })), installations: d.backups.flatMap((b) => b.installations) };
    }
    case "restore": {
      let pageId = v.pageId ? String(v.pageId) : null;
      if (!pageId) {
        const d = await discoverBackups();
        pageId = d.backups.find((b) => b.sameEnvironment && b.restricted)?.pageId || null;
        if (!pageId) return { status: "refused", reason: "No backup found on this site." };
      } else if (!(await store.isBackupPage(pageId))) return { status: "refused", reason: "That page is not a Sentinel Vault backup page." };
      const generationId = v.generationId ? String(v.generationId) : (await loadManifest(pageId, null)).manifest.generationId;
      if (v.preview === true) {
        return { status: "done", preview: await previewGeneration(pageId, generationId) };
      }
      const r = await executeJob({ id: "rest", kind: "restore", actor: accountId, payload: { pageId, generationId, source: "rest" } });
      return { status: r.ok ? "done" : "partial", generationId: r.generationId, written: r.written, failed: r.failed, expired: r.expired, paused: (r.paused || []).map(({ id, label, where }) => ({ id, label, where })), secrets: r.secrets };
    }
    case "export": {
      const target = String(v.pageId);
      if (!(await canEditPage(accountId, target))) return { status: "refused", reason: "You cannot edit that page, so nothing was attached to it." };
      const d = await discoverBackups();
      const own = d.backups.find((b) => b.sameEnvironment && b.restricted);
      if (!own) return { status: "refused", reason: "There is no backup yet — run op=backup first." };
      const doc = await exportGeneration(own.pageId, null);
      const name = `sentinel-vault-export-${doc.manifest.generationId}.json`;
      const attachmentId = await store.putFile(target, name, JSON.stringify(doc));
      await audit("backup.exported", accountId, { generationId: doc.manifest.generationId, keys: doc.manifest.keys, bytes: doc.manifest.bytes, door: "rest", pageId: target });
      return { status: "done", generationId: doc.manifest.generationId, pageId: target, attachmentId, file: name, keys: doc.manifest.keys };
    }
    case "import": {
      const pageId = String(v.pageId);
      const attachmentId = String(v.attachmentId);
      if (!(await canReadPage(accountId, pageId))) return { status: "refused", reason: "You cannot read that page." };
      const att = await store.attachmentOnPage(pageId, attachmentId.startsWith("att") ? attachmentId : `att${attachmentId}`);
      if (!att) return { status: "refused", reason: "That attachment is not on that page." };
      let doc;
      try { doc = JSON.parse(await store.getFile(pageId, att.id)); } catch (_) { return { status: "refused", reason: "The attachment is not a JSON export." }; }
      const imported = await executeJob({ id: "rest", kind: "import", actor: accountId, payload: { doc, source: "rest" } });
      if (!v.restore) return { status: "done", imported };
      const r = await executeJob({ id: "rest", kind: "restore", actor: accountId, payload: { pageId: imported.pageId, generationId: imported.generationId, source: "import" } });
      return { status: r.ok ? "done" : "partial", imported, written: r.written, failed: r.failed, paused: (r.paused || []).map(({ id, label, where }) => ({ id, label, where })), secrets: r.secrets };
    }
    case "resume-automations": {
      const r = await resumePaused(v.ids || null, (key, payload) => invokeResolver(key, payload, accountId));
      if (r.resumed.length) await audit("backup.automations-resumed", accountId, { resumed: r.resumed, failed: r.failed.length, door: "rest" });
      return { status: r.failed.length ? "partial" : "done", ...r };
    }
    case "backup-location": {
      const s = await store.spaceByKey(String(v.spaceKey));
      if (!s) return { status: "refused", reason: `Space ${v.spaceKey} was not found, or the app cannot see it.` };
      const r = await executeJob({ id: "rest", kind: "relocate", actor: accountId, payload: { spaceKey: s.spaceKey } });
      return { status: r.ok === false ? "failed" : "done", spaceKey: r.spaceKey, pageId: r.pageId, generationId: r.generationId };
    }
    default:
      return { status: "refused", reason: `Unknown op ${op}` };
  }
}
