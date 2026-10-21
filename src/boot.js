export { actionRouter } from "./server/registry.js";
import {
  artifactEventTrigger as artifactEventTriggerCore, pageContentTrigger as pageContentTriggerCore, lifecycleTrigger as lifecycleTriggerCore,
  expirySweepTask as expirySweepTaskCore, workflowSweep as workflowSweepCore, pageGuardSweep as pageGuardSweepCore,
} from "./server/triggers.js";
import { recurringNudgeTask as recurringNudgeTaskCore } from "./server/triggers.js";
import { asInvocation } from "./server/shared/confluence-call.js";
// 8.12.0: each trigger call is ONE invocation (shared/confluence-call.js): Confluence 429 retries
// stop inside the function's time limit (these run on the default 25 s), and the permission answers
// a run reads are shared across the pages it judges. The resolvers get the same in registry.js.
export const artifactEventTrigger = asInvocation(artifactEventTriggerCore, { label: "artifactEventTrigger" });
export const pageContentTrigger = asInvocation(pageContentTriggerCore, { label: "pageContentTrigger" });
export const lifecycleTrigger = asInvocation(lifecycleTriggerCore, { label: "lifecycleTrigger" });
export const expirySweepTask = asInvocation(expirySweepTaskCore, { label: "expirySweepTask" });
export const workflowSweep = asInvocation(workflowSweepCore, { label: "workflowSweep" });
export const pageGuardSweep = asInvocation(pageGuardSweepCore, { label: "pageGuardSweep" });
// 8.14.1: a page that leaves the archive gets its pre-8.14 validation property rewritten without account
// ids (Confluence refuses changes while a page is archived; validations/mirror-scrub.js).
import { scrubOnePageMirror } from "./server/capsules/validations/mirror-scrub.js";
export const pageUnarchivedTrigger = asInvocation(async (event) => {
  const id = event?.content?.id;
  if (!id) return;
  const r = await scrubOnePageMirror(String(id));
  if (r !== "clean") console.info(`[VALIDATION-MIRROR] unarchived page: ${r}`);
}, { label: "pageUnarchivedTrigger" });
import { sealIndexCron as sealIndexCronCore } from "./server/capsules/realms/scan-worker.js";
import { backupSweep } from "./server/capsules/backup/worker.js";
import { privacySweepCheck } from "./server/capsules/privacy/worker.js";
// Privacy sweep (capsules/privacy): retention + Atlassian's personal data reporting, weekly. It
// rides the DAILY recurring-nudge trigger for the same reason the backup check rides the hourly
// cron — the manifest is at Forge's limit of 5 scheduled triggers. privacySweepCheck never throws.
export const recurringNudgeTask = asInvocation(async (event, context) => {
  try { return await recurringNudgeTaskCore(event, context); } finally { await privacySweepCheck(context || event?.context); }
}, { label: "recurringNudgeTask" });
// Pillar 12 — backup and restore: the queue consumer, and the hourly check folded into the hourly
// index cron (the manifest is at Forge's limit of 5 scheduled triggers). backupSweep never throws.
export const sealIndexCron = asInvocation(async (event, context) => {
  try { return await sealIndexCronCore(event, context); } finally {
    // The backup check only queues and is cheap: it goes first so a long Jira sweep never starves it.
    await backupSweep(context || event?.context);
    await jiraSealSweep();
  }
}, { budgetMs: 270_000, label: "sealIndexCron" }); // timeoutSeconds 300 in the manifest
// 8.0 — Jira attachment seals: the product-event handler; the hourly lapse sweep rides the index cron.
export { jiraAttachmentEventTrigger } from "./server/capsules/jira-seals/trigger.js";
import { jiraSealSweep } from "./server/capsules/jira-seals/trigger.js";
// DEV-ONLY harness test-state web trigger (gated by HARNESS_SECRET; 404 in prod)
export { testStateTrigger } from "./test-hook.js";

// The config REST API trigger and the queue consumers that run work a user started, each wrapped by
// the action log (server/logged-entrypoints.js; product events and sweeps are exempt there, by name).
export {
  configApiTrigger, configApiConsumer, realmScanConsumer, aiValidationConsumer, backupConsumer, privacyConsumer, jiraRestoreConsumer,
} from "./server/logged-entrypoints.js";
