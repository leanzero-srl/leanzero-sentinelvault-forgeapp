/**
 * PURE (apart from `fn`). Run `fn` over `items` with at most `limit` in flight; the results come
 * back in input order. The one copy: classification, the access-request inbox and the byline
 * fan-out each carried their own until 2026-10-17.
 */
export async function mapLimited(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; results[i] = await fn(list[i], i); } };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, list.length)) }, worker));
  return results;
}
