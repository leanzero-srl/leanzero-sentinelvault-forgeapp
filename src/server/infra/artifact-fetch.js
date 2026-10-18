import { asUser, route } from "@forge/api";
import { appConfluence, userConfluence } from "../shared/confluence-call.js";

// Attachment preview for the Custom UI surfaces (panels resolve-artifact-preview).
//
// 2026-10-11: this file also carried a LEGACY attachment pipeline that nothing called —
// fetchArtifactMetadata (lazily DELETED expired seals on read, via sealing/logic.js
// computeSealStatus, with an unconditional page-property removal), artifactEventHandler /
// handleSealViolation / rollbackArtifact (a second, unwired event handler with pre-S7, pre-SEC-2
// semantics) and downloadArtifactBinary. Confirmed zero callers across src/ (server and UI),
// test/, boot.js, test-hook.js and the manifest, then deleted, so nobody wires the old semantics
// back up by mistake. The live attachment path is triggers.js artifactEventTrigger.

/**
 * Resolve a base64 data URI thumbnail for an image attachment.
 * Used by Custom UI surfaces that cannot load cross-origin images due to Forge CSP.
 *
 * The caller is responsible for having established that the requester may READ contentId;
 * the download itself additionally runs as the user, so this cannot exceed their rights.
 *
 * @param {string} artifactId - The attachment ID
 * @param {string} contentId - The parent page/content ID
 * @returns {Promise<{dataUri: string}|null>} Base64 data URI or null
 */
export async function resolveArtifactPreview(artifactId, contentId) {
  const MAX_PREVIEW_BYTES = 5 * 1024 * 1024; // 5 MB

  try {
    // SV-SEC-1 (exfiltration side). mediaType/fileSize used to be accepted from the resolver
    // payload and, when mediaType was supplied, the metadata read below was SKIPPED — so a
    // caller who simply claimed "image/png" bypassed BOTH the image-only rule and the 5 MB cap
    // and had the app hand back the base64 bytes of any file at all. The type and the size are
    // properties of the attachment, so they are now always read from the attachment, never
    // taken from the caller. The parameters are gone rather than ignored, so no call site can
    // quietly keep passing them.
    const metaResponse = await appConfluence(
      route`/wiki/api/v2/attachments/${artifactId}`,
      { headers: { Accept: "application/json" } },
    );

    if (!metaResponse.ok) {
      console.warn(`[PREVIEW] Failed to fetch metadata for ${artifactId}: ${metaResponse.status}`);
      return null;
    }

    const meta = await metaResponse.json();
    const resolvedMediaType = meta.mediaType;
    const resolvedFileSize = meta.fileSize;

    // Only generate previews for images
    if (!resolvedMediaType || !resolvedMediaType.startsWith("image/")) {
      return null;
    }

    // Skip large files
    if (resolvedFileSize && resolvedFileSize > MAX_PREVIEW_BYTES) {
      console.warn(`[PREVIEW] Skipping ${artifactId}: file too large (${resolvedFileSize} bytes)`);
      return null;
    }

    // Download the image binary via v1 API — as the USER, not the app. The preview is only
    // ever rendered back to the caller (kit/ThumbnailPreview.jsx), so borrowing the app's
    // site-wide read here bought nothing and made the blast radius the whole tenant. asUser
    // makes over-reach structurally impossible rather than merely gated.
    const downloadRoute = route`/wiki/rest/api/content/${contentId}/child/attachment/${artifactId}/download`;
    const downloadResponse = await userConfluence(downloadRoute);

    if (!downloadResponse.ok) {
      console.warn(`[PREVIEW] Failed to download ${artifactId}: ${downloadResponse.status}`);
      return null;
    }

    const buffer = await downloadResponse.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUri = `data:${resolvedMediaType};base64,${base64}`;

    return { dataUri };
  } catch (error) {
    console.error(`[PREVIEW] Error generating preview for ${artifactId}:`, error);
    return null;
  }
}
