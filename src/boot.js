export { actionRouter } from "./server/registry.js";
export { artifactEventTrigger, pageContentTrigger, lifecycleTrigger, expirySweepTask, workflowSweep, pageGuardSweep } from "./server/triggers.js";
import { recurringNudgeTask as recurringNudgeTaskCore } from "./server/triggers.js";
import { sealIndexCron as sealIndexCronCore } from "./server/capsules/realms/scan-worker.js";
import { backupSweep } from "./server/capsules/backup/worker.js";
import { privacySweepCheck } from "./server/capsules/privacy/worker.js";
// Privacy sweep (capsules/privacy): retention + Atlassian's personal data reporting, weekly. It
// rides the DAILY recurring-nudge trigger for the same reason the backup check rides the hourly
// cron — the manifest is at Forge's limit of 5 scheduled triggers. privacySweepCheck never throws.
export { privacyConsumer } from "./server/capsules/privacy/worker.js";
export async function recurringNudgeTask(event, context) {
  try { return await recurringNudgeTaskCore(event, context); } finally { await privacySweepCheck(context || event?.context); }
}
export { realmScanConsumer } from "./server/capsules/realms/scan-worker.js";
export { aiValidationConsumer } from "./server/capsules/validations/ai-worker.js";
// Config REST API (docs/REST-CONFIG-API.md): the static web trigger and its queue consumer.
export { configApiTrigger } from "./server/capsules/config-api/trigger.js";
export { configApiConsumer } from "./server/capsules/config-api/consumer.js";
// Pillar 12 — backup and restore: the queue consumer, and the hourly check folded into the hourly
// index cron (the manifest is at Forge's limit of 5 scheduled triggers). backupSweep never throws.
export { backupConsumer } from "./server/capsules/backup/worker.js";
export async function sealIndexCron(event, context) {
  try { return await sealIndexCronCore(event, context); } finally { await backupSweep(context || event?.context); }
}
// DEV-ONLY harness test-state web trigger (gated by HARNESS_SECRET; 404 in prod)
export { testStateTrigger } from "./test-hook.js";
