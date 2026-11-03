/*
 * ELZI'S TOURS - THE PERSON'S "SEEN" MARKS, read ONCE per page and shared by every tour on it.
 *
 * One resolver answer (get-nux-tours: {seen, version, tours:{<key>:{seen,version}}}) holds a mark per
 * tour (src/shared/nux-tours.js lists them). Every tour on the page reads it from here, and a tour that
 * opens or ends updates the copy in memory at once (noteMark), so a second tour on the same page sees
 * that the first one ran without asking Jira again. A failed read stays {ok:false}: no tour opens by
 * itself on a failed read.
 * One tour on screen at a time: holdOpen / releaseOpen / openTourNow / tourOpenSince live in view-guard.js.
 */
import { invoke } from "../kit/bridge.js";
import { clearViewGuard } from "./view-guard.js";

let read = null;
let cache = null;
const subs = new Set();

const shape = (r) => (r && r.success ? { ok: true, seen: !!r.seen, version: r.version, tours: r.tours || null } : { ok: false });

/** The marks, read once (the first caller starts the read; everyone after gets the same promise). */
export const readMarks = () => {
  if (!read) read = invoke("get-nux-tours").then((r) => { cache = shape(r); return cache; }).catch(() => { cache = { ok: false }; return cache; });
  return read;
};
/** JUDGE SCORE #2: after a Reset cleared this person's marks (demo.js clearTours), the next read asks Jira again. */
export const forgetMarks = () => { read = null; cache = null; };
/** After a Reset (the stored row is gone): every mark reads "not seen" at once, and every tour button and tab hears it.
    The view's "a tour already ran here" note goes too (clearViewGuard), BEFORE the listeners hear it, so the page tour
    opens now in this view instead of on the next visit (live on leanzero-demo 2026-11-03). */
export const resetMarks = () => {
  read = Promise.resolve({ ok: true, seen: false, tours: {} });
  cache = { ok: true, seen: false, tours: {} };
  clearViewGuard();
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

// one tour on screen at a time, none straight after another in the same view (view-guard.js, dependency-free)
export { holdOpen, openTourNow, releaseOpen, tourOpenSince, viewResets } from "./view-guard.js";
