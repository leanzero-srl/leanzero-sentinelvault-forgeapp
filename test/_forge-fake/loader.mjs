// Module-resolution hook (node:module register) that swaps the Forge runtime packages for the
// in-memory fakes in this folder, so a test can import the REAL server modules (triggers.js,
// resolvers) and drive them end to end without a Forge runtime. Registered by test/_forge-fake/
// install.mjs; nothing in src/ knows it exists.
const MAP = {
  "@forge/api": "./api.mjs",
  "@forge/kvs": "./kvs.mjs",
  "@forge/events": "./events.mjs",
  "@forge/object-store": "./object-store.mjs",
  "@forge/llm": "./llm.mjs",
  "@forge/resolver": "./resolver.mjs",
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
