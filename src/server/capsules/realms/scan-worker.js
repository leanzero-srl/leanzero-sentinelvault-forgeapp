import { route } from "@forge/api";
import { appConfluence } from "../../shared/confluence-call.js";
import { markGuardedPage, reopenGuardBackfill } from "../../shared/guarded-page.js"; // the page's seal marker (KVS authority)
import { kvs, WhereConditions } from "@forge/kvs";
import { Queue } from "@forge/events";
import { isLiveAttachmentSeal } from "../../shared/live-seal.js";
import { errText } from "../../shared/action-log.js";

/**
 * Async queue consumer for rebuilding the realm-seal index.
 * Scans all pages in a realm, finds sealed artifacts, and writes
 * space-protection-{realmId}-{artifactId} keys so that the realm steward
 * can query them instantly via KVS prefix.
 *
 * Runs with up to 900s (15 min) timeout configured in manifest.yml.
 *
 * @param {Object} event - Queue event with body: { jobId, spaceKey, spaceId }
 */
export async function realmScanConsumer(event) {
  // Classification review 2026-09-30 (E2): the byline fan-out rides this consumer instead of a new
  // manifest module — a different job kind, dispatched before anything scan-specific runs.
  if (event?.body?.kind === "byline-refresh") {
    const { runBylineRefreshJob } = await import("../page-details/byline-fanout.js");
    return runBylineRefreshJob(event.body);
  }
  const { jobId, spaceKey: realmKey, spaceId: realmId } = event.body;

  // Update status to processing
  await kvs.set(`space-scan-status-${realmId}`, {
    jobId,
    status: "processing",
    startedAt: new Date().toISOString(),
    spaceKey: realmKey,
    spaceId: realmId,
  });

  try {
    let fetchCursor = null;
    let totalPagesFetched = 0;
    let totalArtifactsScanned = 0;
    let sealedCount = 0;
    const notSealIds = new Set(); // current files whose protection- record is not a seal (stub / ownerless)

    // Fetch all pages in the realm using cursor-based pagination
    do {
      let url = route`/wiki/api/v2/spaces/${realmId}/pages?limit=100`;
      if (fetchCursor) {
        url = route`/wiki/api/v2/spaces/${realmId}/pages?limit=100&cursor=${fetchCursor}`;
      }

      const pagesResponse = await appConfluence(url);

      if (!pagesResponse.ok) {
        console.error(`[REALM-SCAN] Pages API error: ${pagesResponse.status}`);
        break;
      }

      const pagesData = await pagesResponse.json();
      const pages = pagesData.results || [];
      totalPagesFetched++;

      // For each page, fetch artifacts
      for (const page of pages) {
        try {
          const artifactResponse = await appConfluence(
            route`/wiki/api/v2/pages/${page.id}/attachments?limit=250`,
          );

          if (!artifactResponse.ok) continue;

          const artifactData = await artifactResponse.json();
          const artifacts = artifactData.results || [];
          totalArtifactsScanned += artifacts.length;

          // Check each artifact for seal status in KVS
          for (const artifact of artifacts) {
            const sealRecord = await kvs.get(`protection-${artifact.id}`);

            // Only a real seal gets a row: the steward console lists every row as a seal. An S7
            // trashedOnly stub on a CURRENT file (restored outside the app, the stub left behind)
            // and an ownerless record are not seals — writing them listed phantom seals ("User ")
            // that unseal then acted on. Such a stub's existing row is dropped in the cleanup.
            if (sealRecord && !isLiveAttachmentSeal(sealRecord)) {
              notSealIds.add(String(artifact.id));
              continue;
            }

            if (sealRecord) {
              // Write/update the realm-seal index key
              await kvs.set(`space-protection-${realmId}-${artifact.id}`, {
                attachmentId: artifact.id,
                attachmentName:
                  artifact.title || sealRecord.attachmentName || "Unknown",
                lockedBy: sealRecord.lockedBy,
                lockedByName:
                  sealRecord.lockedByName ||
                  `User ${(sealRecord.lockedBy || "").slice(-4)}`,
                timestamp: sealRecord.timestamp,
                expiresAt: sealRecord.expiresAt,
                contentId: page.id,
                pageTitle: page.title || "Unknown Page",
                spaceKey: realmKey,
                fileSize: artifact.fileSize || null,
                // The console's download action reads this; a rebuilt row used to drop it (the
                // row sealArtifact writes carries it).
                downloadLink: artifact.downloadLink || artifact._links?.download || sealRecord.downloadLink || null,
                creatorName: null, // Avoid extra API calls in background
                creatorAccountId: artifact.version?.authorId || null,
                workflowHeld: sealRecord.workflowHeld || null, // SEC-2: seal-custody keeps this on the row
              });

              // Also ensure the seal data has realmId for future cleanup. Merged onto a FRESH
              // read, and only while it is still the same seal — writing the scan-start snapshot
              // back would resurrect a seal released while the scan ran. (The space KEY is not
              // stamped: the steward gates derive it from the record's page when it is missing,
              // and the cron pairs this job's id and key from records, not from the space.)
              if (!sealRecord.spaceId) {
                const fresh = await kvs.get(`protection-${artifact.id}`);
                if (isLiveAttachmentSeal(fresh) && !fresh.spaceId && fresh.lockedBy === sealRecord.lockedBy && fresh.timestamp === sealRecord.timestamp) {
                  if (!(await markGuardedPage(fresh.contentId))) await reopenGuardBackfill(); // self-heal: a seal record always has its page marker (the backfill rebuilds it)
                  await kvs.set(`protection-${artifact.id}`, {
                    ...fresh,
                    spaceId: realmId,
                  });
                }
              }

              sealedCount++;
            }
          }
        } catch (artifactError) {
          console.error(
            `[REALM-SCAN] Error processing page ${page.id}:`,
            errText(artifactError),
          );
        }
      }

      // Extract cursor for next batch
      const nextLink = pagesData._links?.next;
      if (nextLink) {
        try {
          const urlObj = new URL(nextLink, "https://example.com");
          fetchCursor = urlObj.searchParams.get("cursor");
        } catch (urlError) {
          fetchCursor = null;
        }
      } else {
        fetchCursor = null;
      }
    } while (fetchCursor);

    // Also clean up any stale realm-seal keys for artifacts that are no longer sealed
    try {
      const prefix = `space-protection-${realmId}-`;
      let cleanupCursor = null;
      let staleCount = 0;

      do {
        let query = kvs
          .query()
          .where("key", WhereConditions.beginsWith(prefix))
          .limit(100);

        if (cleanupCursor) {
          query = query.cursor(cleanupCursor);
        }

        const { results, nextCursor } = await query.getMany();

        for (const { key } of results || []) {
          const artifactId = key.replace(prefix, "");
          const sealExists = await kvs.get(`protection-${artifactId}`);
          // Gone, ownerless, or a trashedOnly stub on a file this scan just saw CURRENT (restored
          // outside the app): not a seal, so not a console row. A stub on a file still in the
          // trash keeps its row — the console shows it as "Trash" and offers restore/purge.
          const notASeal = !sealExists || !sealExists.lockedBy
            || (sealExists.trashedOnly && notSealIds.has(String(artifactId)));
          if (notASeal) {
            await kvs.delete(key);
            staleCount++;
          }
        }

        cleanupCursor = nextCursor;
      } while (cleanupCursor);

      // staleCount tracked in job stats
    } catch (cleanupError) {
      console.warn(
        `[REALM-SCAN] Error during stale key cleanup:`,
        errText(cleanupError),
      );
    }

    // Mark job as completed
    await kvs.set(`space-scan-status-${realmId}`, {
      jobId,
      status: "completed",
      completedAt: new Date().toISOString(),
      spaceKey: realmKey,
      spaceId: realmId,
      stats: {
        pagesBatches: totalPagesFetched,
        artifactsScanned: totalArtifactsScanned,
        sealedFound: sealedCount,
      },
    });

  } catch (error) {
    console.error(`[REALM-SCAN] Job ${jobId} failed:`, errText(error));

    await kvs.set(`space-scan-status-${realmId}`, {
      jobId,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error.message,
      spaceKey: realmKey,
      spaceId: realmId,
    });

    throw error; // Rethrow for Forge retry mechanism
  }
}

/**
 * CRON handler that runs every 30 minutes to keep the realm-seal index warm.
 * Scans all protection-* keys, collects unique realmIds, and pushes a
 * queue job per realm so the consumer rebuilds the index in the background.
 */
export async function sealIndexCron() {
  // Change-detection gate: skip full scan if no seals have changed since last run
  const lastModified = await kvs.get("protections-last-modified");
  const lastScanned = await kvs.get("protections-last-scanned");
  if (lastModified && lastScanned && lastModified <= lastScanned) {
    return { statusCode: 200, body: JSON.stringify({ realmsQueued: 0, skipped: true }) };
  }

  const realmAuditQueue = new Queue({ key: "realm-audit-queue" });
  const realmMap = new Map(); // realmId → realmKey

  // Collect all unique realms that have active seals
  let cursor = null;
  let iteration = 0;

  do {
    iteration++;
    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith("protection-"))
      .limit(100);

    if (cursor) {
      query = query.cursor(cursor);
    }

    const { results, nextCursor } = await query.getMany();

    for (const { value } of results || []) {
      if (value?.spaceId && value?.spaceKey && !realmMap.has(value.spaceId)) {
        realmMap.set(value.spaceId, value.spaceKey);
      }
    }

    cursor = nextCursor;

    if (iteration >= 20) {
      console.warn("[INDEX-CRON] Hit iteration limit collecting realms");
      break;
    }
  } while (cursor);

  if (realmMap.size === 0) {
    return { statusCode: 200, body: JSON.stringify({ realmsQueued: 0 }) };
  }

  // Push a scan job per realm (skip if already processing)
  let queued = 0;
  for (const [realmId, realmKey] of realmMap) {
    const existingStatus = await kvs.get(`space-scan-status-${realmId}`);
    if (existingStatus?.status === "processing") {
      continue;
    }

    const jobId = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await kvs.set(`space-scan-status-${realmId}`, {
      jobId,
      status: "queued",
      createdAt: new Date().toISOString(),
      spaceKey: realmKey,
      spaceId: realmId,
      triggeredBy: "cron",
    });

    await realmAuditQueue.push({
      body: { jobId, spaceKey: realmKey, spaceId: realmId },
    });

    queued++;
  }

  // Mark scan timestamp so next run can skip if nothing changed
  await kvs.set("protections-last-scanned", Date.now());
  return { statusCode: 200, body: JSON.stringify({ realmsQueued: queued }) };
}
