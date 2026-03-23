/**
 * Panels capsule — thin wrapper around the doc-surgery infrastructure
 * for panel/macro-specific business logic.
 *
 * The heavy ADF manipulation (find/remove extension nodes, fetch/write page ADF,
 * inject macro with retry, remove macro) lives in infra/doc-surgery.js.
 * This module re-exports those functions and adds any panel-specific
 * orchestration on top.
 */
export {
  locateExtensionNodes,
  removeExtensionDeep,
  panelExistsInDoc,
  buildExtensionNode,
  readDocBody,
  writeDocBody,
  insertPanelNode,
  removePanelNode,
  triggerPanelEmbed,
} from "../../infra/doc-surgery.js";
