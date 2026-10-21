// PURE. Set `key` on `obj` as an ordinary own, enumerable property — whatever the key is.
//
// JSON.parse (Confluence content read over REST, a REST config body) keeps every key as an
// ordinary OWN key, including one named "__proto__". A copy keeps all of them only when each is
// defined as an own property; plain assignment treats that one name as the prototype. Every copy
// loop whose keys come from data uses this; JSON.stringify of the result names every key, so
// stringified comparisons and hashes cover the whole content.
export function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  return obj;
}
