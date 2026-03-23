import { asApp, route } from "@forge/api";
import { kvs } from "@forge/kvs";

const PANEL_KEY_SUFFIX = "/static/sentinel-vault-panel";

/**
 * Check if an extension key matches the panel suffix
 */
export function isPanelExtensionKey(extensionKey) {
  return extensionKey?.endsWith(PANEL_KEY_SUFFIX);
}

/**
 * Recursively search ADF tree for extension nodes matching a predicate
 */
export function locateExtensionNodes(node, predicate) {
  const results = [];
  if (!node) return results;
  if (
    ["extension", "bodiedExtension", "inlineExtension"].includes(node.type) &&
    predicate(node)
  ) {
    results.push(node);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      results.push(...locateExtensionNodes(child, predicate));
    }
  }
  return results;
}

/**
 * Recursively remove extension nodes matching a predicate from ADF tree
 */
export function removeExtensionDeep(node, predicate) {
  if (!node?.content) return node;
  node.content = node.content.filter((child) => {
    if (
      ["extension", "bodiedExtension", "inlineExtension"].includes(
        child.type,
      ) &&
      predicate(child)
    ) {
      return false;
    }
    removeExtensionDeep(child, predicate);
    return true;
  });
  return node;
}

/**
 * Check if the Sentinel Vault panel exists on a page
 * Check if the Sentinel Vault panel extension node exists in the ADF
 */
export function panelExistsInDoc(adfDoc) {
  return (
    locateExtensionNodes(
      adfDoc,
      (node) => isPanelExtensionKey(node.attrs?.extensionKey),
    ).length > 0
  );
}

/**
 * Build the ADF extension node for the Sentinel Vault panel
 * Always uses the new panel key suffix for new insertions
 */
export function buildExtensionNode(extensionKey) {
  // extensionKey format: <appId>/<envId>/static/sentinel-vault-panel
  // extensionId format: ari:cloud:ecosystem::extension/<appId>/<envId>/static/sentinel-vault-panel
  const parts = extensionKey.split("/");
  const appId = parts[0];
  const envId = parts[1];
  const extensionId = `ari:cloud:ecosystem::extension/${appId}/${envId}${PANEL_KEY_SUFFIX}`;

  return {
    type: "extension",
    attrs: {
      extensionType: "com.atlassian.ecosystem",
      extensionKey,
      layout: "default",
      parameters: {
        extensionId,
        extensionTitle: "Sentinel Vault",
        guestParams: {},
      },
    },
  };
}

/**
 * Fetch a page's ADF body via the v2 API
 * Returns { pageData, adfDoc } where pageData is the full response
 * and adfDoc is the parsed ADF document
 */
export async function readDocBody(pageId) {
  const response = await asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`,
    { headers: { Accept: "application/json" } },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch page ${pageId}: ${response.status} - ${errorText}`,
    );
  }

  const pageData = await response.json();
  const adfDoc = JSON.parse(pageData.body.atlas_doc_format.value);
  return { pageData, adfDoc };
}

/**
 * Write ADF body back to a page via the v2 API
 * body.value MUST be a JSON string (double-stringify pattern)
 */
export async function writeDocBody(pageId, pageData, adfDoc, message) {
  const response = await asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: pageId,
        status: pageData.status,
        title: pageData.title,
        body: {
          representation: "atlas_doc_format",
          value: JSON.stringify(adfDoc), // double-stringify: critical
        },
        version: {
          number: pageData.version.number + 1,
          message: message || "Sentinel Vault panel update",
        },
      }),
    },
  );

  return response;
}

/**
 * Insert the Sentinel Vault panel at the configured position of a page with retry logic
 * Returns { success, skipped, error }
 */
export async function insertPanelNode(pageId, extensionKey, maxRetries = 3, position = "bottom") {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { pageData, adfDoc } = await readDocBody(pageId);

      // Skip if panel already exists (checks both old and new suffixes)
      if (panelExistsInDoc(adfDoc)) {
        return { success: true, skipped: true };
      }

      if (!adfDoc.content) adfDoc.content = [];

      // Insert extension node at the configured position
      const node = buildExtensionNode(extensionKey);
      if (position === "top") {
        adfDoc.content.unshift(node);
      } else {
        adfDoc.content.push(node);
      }

      const putRes = await writeDocBody(
        pageId,
        pageData,
        adfDoc,
        "Auto-inserted Sentinel Vault panel",
      );

      if (putRes.ok) {
        return { success: true, skipped: false };
      }

      if (putRes.status === 409) {
        // Version conflict — retry with exponential backoff
        const delay = Math.pow(2, attempt) * 500;
        console.warn(
          `[ADF] Version conflict on page ${pageId}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const errorText = await putRes.text();
      return {
        success: false,
        error: `Page update failed: ${putRes.status} - ${errorText}`,
      };
    } catch (err) {
      if (attempt === maxRetries - 1) {
        return { success: false, error: err.message };
      }
      const delay = Math.pow(2, attempt) * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return { success: false, error: "Max retries exceeded" };
}

/**
 * Remove the Sentinel Vault panel from a page
 * Handles both legacy and new panel key suffixes
 * Returns { success, error }
 */
export async function removePanelNode(pageId) {
  try {
    const { pageData, adfDoc } = await readDocBody(pageId);

    if (!panelExistsInDoc(adfDoc)) {
      return { success: true, skipped: true };
    }

    removeExtensionDeep(
      adfDoc,
      (node) => isPanelExtensionKey(node.attrs?.extensionKey),
    );

    const putRes = await writeDocBody(
      pageId,
      pageData,
      adfDoc,
      "Removed Sentinel Vault panel",
    );

    if (putRes.ok) {
      return { success: true };
    }

    const errorText = await putRes.text();
    return {
      success: false,
      error: `Page update failed: ${putRes.status} - ${errorText}`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Handle auto-insertion of the Sentinel Vault panel when a seal is first created.
 * Checks space settings and page settings before inserting.
 * Called from seal-artifact resolver.
 */
export async function triggerPanelEmbed(contentId, spaceKey) {
  if (!contentId) {
    console.warn("[PANEL-AUTO] No contentId provided, skipping");
    return;
  }

  try {
    // Get the stored extension key (set by the panel Custom UI on first render)
    const extensionKey = await kvs.get("macro-extension-key");
    if (!extensionKey) {
      console.info(
        "[PANEL-AUTO] Extension key not yet discovered, skipping auto-insert",
      );
      return;
    }

    // Check space setting for autoInsertMacro and read position preference
    let panelInsertPosition = "bottom";
    if (spaceKey) {
      const sanitizedSpaceKey = spaceKey.replace(/[^a-zA-Z0-9:._\s-#]/g, "_");
      const spaceSettings = await kvs.get(
        `admin-settings-space-${sanitizedSpaceKey}`,
      );
      if (spaceSettings?.autoInsertMacro === false) {
        console.info(
          `[PANEL-AUTO] Auto-insert disabled for space ${spaceKey}, skipping`,
        );
        return;
      }
      if (spaceSettings?.macroInsertPosition === "top") {
        panelInsertPosition = "top";
      }
    }

    // Check page-level setting for macroDisabled
    try {
      const propsRes = await asApp().requestConfluence(
        route`/wiki/api/v2/pages/${contentId}/properties?key=sentinel-vault-page-settings`,
      );
      if (propsRes.ok) {
        const propsData = await propsRes.json();
        const pageSetting = propsData.results?.[0]?.value;
        if (pageSetting?.macroDisabled === true) {
          console.info(
            `[PANEL-AUTO] Panel disabled for page ${contentId}, skipping`,
          );
          return;
        }
      }
    } catch (e) {
      console.warn("[PANEL-AUTO] Failed to check page settings:", e);
    }

    // Insert the panel at the configured position
    const result = await insertPanelNode(contentId, extensionKey, 3, panelInsertPosition);
    if (result.success) {
      if (result.skipped) {
        console.info(
          `[PANEL-AUTO] Panel already exists on page ${contentId}, skipped`,
        );
      } else {
        console.info(
          `[PANEL-AUTO] Successfully auto-inserted panel on page ${contentId}`,
        );
      }
    } else {
      console.error(
        `[PANEL-AUTO] Failed to auto-insert panel: ${result.error}`,
      );
    }
  } catch (error) {
    console.error("[PANEL-AUTO] Error in panel auto-insert:", error);
  }
}
