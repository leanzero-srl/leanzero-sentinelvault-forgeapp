/*
 * ELZI'S TOURS - THE PERSON'S "SEEN" MARKS, read ONCE per page and shared by every tour on it.
 *
 * One resolver answer (get-nux-tours: {seen, version, tours:{<key>:{seen,version}}}) holds a mark per
 * tour (src/shared/nux-tours.js lists them). Every tour on the page reads it from here, and a tour that
 * opens or ends updates the copy in memory at once (noteMark), so a second tour on the same page sees
 * that the first one ran without asking Jira again. A failed read stays {ok:false}: no tour opens by
 * itself on a failed read.
 * One tour on screen at a time: holdOpen / releaseOpen / openTourNow (a plain module flag, so two tour
 * instances in one frame never draw two dims).
 */
import { invoke } from "../kit/bridge.js";

let read = null;
let cache = null;
const subs = new Set();
let openKey = null;

const shape = (r) => (r && r.success ? { ok: true, seen: !!r.seen, version: r.version, tours: r.tours || null } : { ok: false });

/** The marks, read once (the first caller starts the read; everyone after gets the same promise). */
export const readMarks = () => {
  if (!read) read = invoke("get-nux-tours").then((r) => { cache = shape(r); return cache; }).catch(() => { cache = { ok: false }; return cache; });
  return read;
};
/** JUDGE SCORE #2: after a Reset cleared this person's marks (demo.js clearTours), the next read asks Jira again. */
export const forgetMarks = () => { read = null; cache = null; };
/** After a Reset (the stored row is gone): every mark reads "not seen" at once, and every tour button and tab hears it. */
export const resetMarks = () => {
  read = Promise.resolve({ ok: true, seen: false, tours: {} });
  cache = { ok: true, seen: false, tours: {} };
  for (const fn of subs) { try { fn(cache); } catch (e) { /* a gone listener */ } }
};
/** What is known now (null until the read answered). */
export const marksNow = () => cache;
/** Tell every tour on the page when the marks change. Returns the unsubscribe. */
export const onMarks = (fn) => { subs.add(fn); return () => subs.delete(fn); };
/** A tour opened or ended: its mark is "seen" in memory at once (the resolver write runs beside it). */
export const noteMark = (key, version, how = "done") => {
  if (cache && cache.ok) cache = { ...cache, tours: { ...(cache.tours || {}), [key]: { seen: true, version, how } } };
  for (const fn of subs) { try { fn(cache); } catch (e) { /* a gone listener */ } }
};
/** Has this person seen ANY tour yet? (Elzi says who she is only on the first one, for module tours.) */
export const anyTourSeen = (m) => !!(m && m.ok === true && (m.seen || (m.tours && Object.values(m.tours).some((t) => t && t.seen))));
/** Has this person seen this tour? (false while unknown) */
export const tourSeen = (m, key) => !!(m && m.ok === true && m.tours && m.tours[key] && m.tours[key].seen);
/* Listed 1.35.22 review: did this person go through this tour to its end ("done"), not skip it or only have it
   shown? An admin who presses Skip on the page tour is not then met by a tour on every tab (false while unknown). */
export const tourFinished = (m, key) => tourSeen(m, key) && m.tours[key].how === "done";

export const openTourNow = () => openKey;
let lastOpenAt = -1;
let lastCloseAt = -1; // a tour that opened before `t` and closed after it was on screen since `t` too
export const holdOpen = (key) => { openKey = key; lastOpenAt = Date.now(); };
/*
 * Was a tour on screen at any moment since `t`? A tour opens by itself only into a view where no
 * tour has run since it was put on screen: the glance's activity tour does not follow straight after
 * the gate tour, and an admin tab's mini-tour waits for the next tab visit after the page tour.
 */
export const tourOpenSince = (t) => openKey !== null || lastOpenAt >= t || lastCloseAt >= t;
export const releaseOpen = (key) => { if (openKey === key) { openKey = null; lastCloseAt = Date.now(); } };
