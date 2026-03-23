/**
 * Palette Sync Utility for Sentinel Vault
 *
 * This utility enables Confluence theme detection and synchronization
 * using the Forge Bridge API. It activates the theme system that responds
 * to html[data-color-mode] attribute changes.
 */

import { view } from "@forge/bridge";

let paletteInitialized = false;
let initializationPromise = null;

/**
 * Enable palette detection and synchronization with Confluence
 *
 * This function calls view.theme.enable() which:
 * - Fetches the current active theme from Confluence
 * - Applies the theme by setting data-color-mode attribute on <html>
 * - Reactively updates when the host theme changes
 * - Enables CSS variables defined in foundation.css to work properly
 *
 * @returns {Promise<void>}
 */
export async function enablePaletteSync() {
  if (paletteInitialized) {
    return;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = initializePalette();
  return initializationPromise;
}

async function initializePalette() {
  try {
    await view.theme.enable();
    paletteInitialized = true;
  } catch (error) {
    console.warn("Failed to enable theme detection:", error);
    paletteInitialized = true;
  }
}

/**
 * Get the current palette mode
 *
 * @returns {'light' | 'dark' | 'unknown'}
 */
export function readPaletteMode() {
  const htmlElement = document.documentElement;
  const colorMode = htmlElement.getAttribute("data-color-mode");

  if (colorMode === "dark") return "dark";
  if (colorMode === "light") return "light";
  return "unknown";
}

/**
 * Check if dark palette is currently active
 *
 * @returns {boolean}
 */
export function isDarkPalette() {
  return readPaletteMode() === "dark";
}

/**
 * Add a palette change listener
 *
 * @param {function} callback - Function to call when palette changes
 * @returns {function} Cleanup function to remove the listener
 */
export function onPaletteChange(callback) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "data-color-mode"
      ) {
        const newMode = readPaletteMode();
        callback(newMode);
      }
    });
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-mode"],
  });

  return () => observer.disconnect();
}

/**
 * Hook for React components to use theme detection
 * This should be called in useEffect in React components
 *
 * @returns {Promise<void>}
 */
export async function usePaletteDetection() {
  return enablePaletteSync();
}

export default {
  enablePaletteSync,
  readPaletteMode,
  isDarkPalette,
  onPaletteChange,
  usePaletteDetection,
};
