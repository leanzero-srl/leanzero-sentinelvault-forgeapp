// Module-resolution hook: swaps @forge/bridge for ./bridge.mjs (test/action-log.test.mjs only).
export async function resolve(specifier, context, next) {
  if (specifier === "@forge/bridge") return { url: new URL("./bridge.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
