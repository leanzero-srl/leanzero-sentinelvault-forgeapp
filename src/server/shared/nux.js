// ELZI'S TOURS - the person's "seen" marks, one KVS row per person.
//
// `nux:<accountId>` holds {v:1, tours:{<key>:{version, how, at}}}: per tour (src/ui/nux/nux-tours.js, the
// one list), the tour version the person was shown, finished or skipped, and when. Nothing else: no page,
// no space, no content. Read and written for the CALLER's own account only (context.accountId; no payload
// field can name another person). The row's key names the account, so the personal-data worker finds it
// and deletes it whole when the account closes (capsules/privacy/accounts.js). It is a preference, not
// configuration: a backup does not carry it, and the only cost of losing it is that a tour shows once more.
// `how: "shown"` is written the moment a tour opens by itself, so a reload halfway through does not open
// it again. Reset deletes the caller's own row.
import { kvs } from "@forge/kvs";
import { NUX_TOUR_KEYS } from "../../ui/nux/nux-tours.js";

export const NUX_PREFIX = "nux:";
const HOW = new Set(["done", "skipped", "shown"]);

export const nuxKey = (accountId) => {
  const id = String(accountId || "").replace(/[^0-9A-Za-z:_-]/g, "").slice(0, 128);
  return id ? `${NUX_PREFIX}${id}` : "";
};

const markOf = (m) => (m && typeof m === "object" && m.version != null
  ? { version: Number(m.version) || 0, how: HOW.has(m.how) ? m.how : "done", at: typeof m.at === "string" ? m.at : null }
  : null);
const marksOf = (row) => {
  const out = {};
  if (!row || typeof row !== "object" || !row.tours || typeof row.tours !== "object") return out;
  for (const t of NUX_TOUR_KEYS) { const m = markOf(row.tours[t]); if (m) out[t] = m; }
  return out;
};

/** {ok, tours:{<key>:{seen, version, how?}}} for this person; ok:false when there is no person or the read failed. */
export const readNux = async (accountId, store = kvs) => {
  const key = nuxKey(accountId);
  if (!key) return { ok: false };
  try {
    const marks = marksOf(await store.get(key));
    const tours = {};
    for (const t of NUX_TOUR_KEYS) tours[t] = marks[t] ? { seen: true, ...marks[t] } : { seen: false, version: 0 };
    return { ok: true, tours };
  } catch (e) {
    return { ok: false, fault: true };
  }
};

/** Mark one tour shown, finished or skipped for this person; the other marks are kept. A key not in the list is refused. */
export const writeNux = async (accountId, { version, how, tour } = {}, store = kvs, now = Date.now()) => {
  const key = nuxKey(accountId);
  if (!key) return { ok: false };
  if (!NUX_TOUR_KEYS.includes(tour)) return { ok: false };
  const mark = { version: Math.max(1, Math.min(1000, Math.floor(Number(version) || 1))), how: HOW.has(how) ? how : "done", at: new Date(now).toISOString() };
  try {
    const marks = marksOf(await store.get(key));
    marks[tour] = mark;
    await store.set(key, { v: 1, tours: marks });
    return { ok: true, tour, ...mark };
  } catch (e) {
    return { ok: false };
  }
};

/** Forget this person's marks (their own row only), so every tour shows again. */
export const clearNux = async (accountId, store = kvs) => {
  const key = nuxKey(accountId);
  if (!key) return { ok: false };
  try { await store.delete(key); return { ok: true, reset: true }; } catch (e) { return { ok: false }; }
};
