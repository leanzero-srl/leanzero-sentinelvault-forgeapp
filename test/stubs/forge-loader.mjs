// Resolve hook: redirect the @forge/* bare specifiers to local stubs so the REAL resolvers can be
// driven in-process. Registered via node:module `register` from the test file.
const MAP = {
  "@forge/api": new URL("./forge-api.mjs", import.meta.url).href,
  "@forge/kvs": new URL("./forge-kvs.mjs", import.meta.url).href,
  "@forge/events": new URL("./forge-events.mjs", import.meta.url).href,
  "@forge/llm": new URL("./forge-llm.mjs", import.meta.url).href,
  "@forge/resolver": new URL("./forge-resolver.mjs", import.meta.url).href,
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return next(specifier, context);
}
