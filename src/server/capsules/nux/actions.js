// Elzi's tours: the caller's own "seen" marks (shared/nux.js). Every action works on context.accountId and
// nothing in the payload can name another person. Not site configuration, so none of it is backed up.
import { readNux, writeNux, clearNux } from "../../shared/nux.js";

const getNuxTours = async (req) => {
  const r = await readNux(req?.context?.accountId);
  return r.ok ? { success: true, tours: r.tours } : { success: false };
};
const setNuxTour = async (req) => {
  const p = req?.payload || {};
  const r = await writeNux(req?.context?.accountId, { version: p.version, how: p.how, tour: p.tour });
  return r.ok ? { success: true, tour: r.tour, version: r.version, how: r.how } : { success: false };
};
const resetNuxTours = async (req) => {
  const r = await clearNux(req?.context?.accountId);
  return r.ok ? { success: true } : { success: false };
};

export const actions = [
  ["get-nux-tours", getNuxTours],
  ["set-nux-tour", setNuxTour],
  ["reset-nux-tours", resetNuxTours],
];
