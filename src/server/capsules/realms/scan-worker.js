import { asApp, route } from "@forge/api";
import { kvs, WhereConditions } from "@forge/kvs";
import { Queue } from "@forge/events";

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
  const { jobId, spaceKey: realmKey, spaceId: realmId } = event.body;

  console.log(
    `[REALM-SCAN] Starting scan job ${jobId} for realm ${realmKey} (${realmId})`,
  );

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

    // Fetch all pages in the realm using cursor-based pagination
    do {
      let url = route`/wiki/api/v2/spaces/${realmId}/pages?limit=100`;
      if (fetchCursor) {
        url = route`/wiki/api/v2/spaces/${realmId}/pages?limit=100&cursor=${fetchCursor}`;
      }

      const pagesResponse = await asApp().requestConfluence(url);

      if (!pagesResponse.ok) {
        console.error(`[REALM-SCAN] Pages API error: ${pagesResponse.status}`);
        break;
      }

      const pagesData = await pagesResponse.json();
      const pages = pagesData.results || [];
      totalPagesFetched++;

      console.log(
        `[REALM-SCAN] Batch ${totalPagesFetched}: ${pages.length} pages`,
      );

      // For each page, fetch artifacts
      for (const page of pages) {
        try {
          const artifactResponse = await asApp().requestConfluence(
            route`/wiki/api/v2/pages/${page.id}/attachments?limit=250`,
          );

          if (!artifactResponse.ok) continue;

          const artifactData = await artifactResponse.json();
          const artifacts = artifactData.results || [];
          totalArtifactsScanned += artifacts.length;

          // Check each artifact for seal status in KVS
          for (const artifact of artifacts) {
            const sealRecord = await kvs.get(`protection-${artifact.id}`);

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
                creatorName: null, // Avoid extra API calls in background
                creatorAccountId: artifact.version?.authorId || null,
              });

              // Also ensure the seal data has realmId for future cleanup
              if (!sealRecord.spaceId) {
                await kvs.set(`protection-${artifact.id}`, {
                  ...sealRecord,
                  spaceId: realmId,
                });
              }

              sealedCount++;
            }
          }
        } catch (artifactError) {
          console.error(
            `[REALM-SCAN] Error processing page ${page.id}:`,
            artifactError,
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

        for (const { key, value } of results || []) {
          const artifactId = key.replace(prefix, "");
          const sealExists = await kvs.get(`protection-${artifactId}`);
          if (!sealExists) {
            await kvs.delete(key);
            staleCount++;
          }
        }

        cleanupCursor = nextCursor;
      } while (cleanupCursor);

      if (staleCount > 0) {
        console.log(
          `[REALM-SCAN] Cleaned up ${staleCount} stale realm-seal keys`,
        );
      }
    } catch (cleanupError) {
      console.warn(
        `[REALM-SCAN] Error during stale key cleanup:`,
        cleanupError,
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

    console.log(
      `[REALM-SCAN] Job ${jobId} completed: scanned ${totalArtifactsScanned} artifacts across ${totalPagesFetched} batches, found ${sealedCount} sealed`,
    );
  } catch (error) {
    console.error(`[REALM-SCAN] Job ${jobId} failed:`, error);

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
  console.info("[INDEX-CRON] Starting realm-seal index refresh");

  // Change-detection gate: skip full scan if no seals have changed since last run
  const lastModified = await kvs.get("protections-last-modified");
  const lastScanned = await kvs.get("protections-last-scanned");
  if (lastModified && lastScanned && lastModified <= lastScanned) {
    console.info("[INDEX-CRON] No seal changes since last scan — skipping");
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

  console.info(`[INDEX-CRON] Found ${realmMap.size} realms with active seals`);

  if (realmMap.size === 0) {
    return { statusCode: 200, body: JSON.stringify({ realmsQueued: 0 }) };
  }

  // Push a scan job per realm (skip if already processing)
  let queued = 0;
  for (const [realmId, realmKey] of realmMap) {
    const existingStatus = await kvs.get(`space-scan-status-${realmId}`);
    if (existingStatus?.status === "processing") {
      console.log(`[INDEX-CRON] Skipping realm ${realmKey} - scan in progress`);
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
    console.log(`[INDEX-CRON] Queued scan for realm ${realmKey} (${realmId})`);
  }

  // Mark scan timestamp so next run can skip if nothing changed
  await kvs.set("protections-last-scanned", Date.now());

  console.info(`[INDEX-CRON] Done — queued ${queued} realm scans`);
  return { statusCode: 200, body: JSON.stringify({ realmsQueued: queued }) };
}
