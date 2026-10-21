/*
 * The action log (shared/action-log.js) for what users start OUTSIDE a resolver: the config REST API
 * request (one line per call, `rest.<op>`, by the static output it answered; the job then prints one
 * line per operation, config-api/consumer.js) and the queue consumers that run work a user started
 * (`job.<queue>[.<kind>]`: a space scan, an AI review, a backup or restore, a REST job, putting a
 * deleted sealed Jira file back). boot.js exports these. Product-event triggers and scheduled sweeps
 * are not user actions and keep their own lines: ACTION_LOG_EXEMPT names each, with the reason
 * (test/action-log.test.mjs: every manifest function is logged or listed here).
 */
import { logged, withJobLog } from "./shared/action-log.js";
import { privacyConsumer as privacyConsumerCore } from "./capsules/privacy/worker.js";
import { realmScanConsumer as realmScanConsumerCore } from "./capsules/realms/scan-worker.js";
import { aiValidationConsumer as aiValidationConsumerCore } from "./capsules/validations/ai-worker.js";
import { configApiTrigger as configApiTriggerCore } from "./capsules/config-api/trigger.js";
import { configApiConsumer as configApiConsumerCore } from "./capsules/config-api/consumer.js";
import { OPS as REST_OPS, OUTPUT as REST_OUTPUT } from "./capsules/config-api/admission.js";
import { backupConsumer as backupConsumerCore } from "./capsules/backup/worker.js";
import { jiraRestoreConsumer as jiraRestoreConsumerCore } from "./capsules/jira-seals/trigger.js";

const restOpOf = (req) => {
  const q = req?.queryParameters || {};
  const raw = Array.isArray(q.op) ? q.op[0] : q.op;
  const op = String(raw ?? "bundle").toLowerCase();
  return REST_OPS.includes(op) ? op : "unknown";
};
const REST_OUTCOME = {
  [REST_OUTPUT.accepted]: { outcome: "ok" },
  [REST_OUTPUT.invalid]: { outcome: "refused", reason: "invalid" },
  [REST_OUTPUT.unauthorized]: { outcome: "denied", reason: "unauthorized" },
  [REST_OUTPUT.forbidden]: { outcome: "denied", reason: "forbidden" },
  [REST_OUTPUT.notAllowed]: { outcome: "refused", reason: "not-allowed" },
  [REST_OUTPUT.conflict]: { outcome: "refused", reason: "conflict" },
  [REST_OUTPUT.busy]: { outcome: "busy" },
};
export const configApiTrigger = logged(configApiTriggerCore, {
  describe: (req) => ({ via: "rest", action: `rest.${restOpOf(req)}`, surface: "rest-api" }),
  classify: (r) => REST_OUTCOME[r?.outputKey] || { outcome: "error", errorType: "unknown-output" },
});
// A REST job: error when it crashed or a step threw; refused when a step was refused or skipped; ok when
// every step applied. (Its receipt's "failed" also covers "all refused", which is not an error.)
const classifyRestJob = (r) => {
  if (!r || typeof r !== "object") return { outcome: "ok" };
  if (r.ok === false) return { outcome: "refused" };
  if (r.crashed || (r.summary && r.summary.failed > 0)) return { outcome: "error" };
  if (r.status && r.status !== "done") return { outcome: "refused" };
  return { outcome: "ok" };
};
export const __classifyRestJob = classifyRestJob; // tests
export const configApiConsumer = withJobLog("config-api", configApiConsumerCore, { classify: classifyRestJob });
export const realmScanConsumer = withJobLog("realm-audit", realmScanConsumerCore, { kinds: ["byline-refresh"] });
export const aiValidationConsumer = withJobLog("ai-validation", aiValidationConsumerCore, { kinds: ["gate"], kindOf: (e) => e?.body?.mode, limitMs: 120_000 });
export const backupConsumer = withJobLog("backup", backupConsumerCore, { kinds: ["backup", "job"] });
export const privacyConsumer = withJobLog("privacy", privacyConsumerCore, { kinds: ["sweep"] });
export const jiraRestoreConsumer = withJobLog("jira-restore", jiraRestoreConsumerCore, { kinds: ["issue-deleted"], limitMs: 300_000 });

/** Manifest functions that are NOT user actions, and why (test/action-log.test.mjs reads this). */
export const ACTION_LOG_EXEMPT = Object.freeze({
  testStateTrigger: "the dev-only harness hook; production strips it",
  artifactEventTrigger: "a Confluence product event, not a user action in the app",
  pageContentTrigger: "a Confluence product event, not a user action in the app",
  lifecycleTrigger: "install / uninstall events",
  jiraAttachmentEventTrigger: "a Jira product event; the restore it queues is logged as job.jira-restore",
  expirySweepTask: "a scheduled sweep",
  recurringNudgeTask: "a scheduled sweep",
  sealIndexCron: "a scheduled sweep",
  workflowSweep: "a scheduled sweep",
  pageGuardSweep: "a scheduled sweep",
});
