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
export const artifactEventTrigger = asInvocation(artifactEventTriggerCore);
export const pageContentTrigger = asInvocation(pageContentTriggerCore);
export const lifecycleTrigger = asInvocation(lifecycleTriggerCore);
export const expirySweepTask = asInvocation(expirySweepTaskCore);
export const workflowSweep = asInvocation(workflowSweepCore);
export const pageGuardSweep = asInvocation(pageGuardSweepCore);
import { sealIndexCron as sealIndexCronCore } from "./server/capsules/realms/scan-worker.js";
import { backupSweep } from "./server/capsules/backup/worker.js";
import { privacySweepCheck } from "./server/capsules/privacy/worker.js";
// Privacy sweep (capsules/privacy): retention + Atlassian's personal data reporting, weekly. It
// rides the DAILY recurring-nudge trigger for the same reason the backup check rides the hourly
// cron — the manifest is at Forge's limit of 5 scheduled triggers. privacySweepCheck never throws.
export { privacyConsumer } from "./server/capsules/privacy/worker.js";
export const recurringNudgeTask = asInvocation(async (event, context) => {
  try { return await recurringNudgeTaskCore(event, context); } finally { await privacySweepCheck(context || event?.context); }
});
export { realmScanConsumer } from "./server/capsules/realms/scan-worker.js";
export { aiValidationConsumer } from "./server/capsules/validations/ai-worker.js";
// Config REST API (docs/REST-CONFIG-API.md): the static web trigger and its queue consumer.
export { configApiTrigger } from "./server/capsules/config-api/trigger.js";
export { configApiConsumer } from "./server/capsules/config-api/consumer.js";
// Pillar 12 — backup and restore: the queue consumer, and the hourly check folded into the hourly
// index cron (the manifest is at Forge's limit of 5 scheduled triggers). backupSweep never throws.
export { backupConsumer } from "./server/capsules/backup/worker.js";
export const sealIndexCron = asInvocation(async (event, context) => {
  try { return await sealIndexCronCore(event, context); } finally {
    // The backup check only queues and is cheap: it goes first so a long Jira sweep never starves it.
    await backupSweep(context || event?.context);
    await jiraSealSweep();
  }
}, { budgetMs: 270_000 }); // timeoutSeconds 300 in the manifest
// 8.0 — Jira attachment seals: the product-event handler; the hourly lapse sweep rides the index cron.
export { jiraAttachmentEventTrigger, jiraRestoreConsumer } from "./server/capsules/jira-seals/trigger.js";
import { jiraSealSweep } from "./server/capsules/jira-seals/trigger.js";
// DEV-ONLY harness test-state web trigger (gated by HARNESS_SECRET; 404 in prod)
export { testStateTrigger } from "./test-hook.js";
