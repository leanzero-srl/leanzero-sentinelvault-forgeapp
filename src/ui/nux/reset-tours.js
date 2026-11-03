// The whole "Show all tours again" reset, apart from its dialog (ResetTours.jsx), so tests drive it with fakes.
import { clearNuxShownHere } from "./nux-tours.js";
import { forgetAutoShown } from "./tourSteps.js";

/** The whole reset, in one place (tests drive it with fakes). Resolves {ok}; nothing is cleared locally when the stored row could not be cleared. */
export const resetAllTours = async ({ call, session, local, forget }) => {
  let r;
  try { r = await call("reset-nux-tours"); } catch (e) { r = null; }
  if (!r || r.success !== true) return { ok: false };
  clearNuxShownHere(session);
  forgetAutoShown(session, local);
  if (forget) forget();
  return { ok: true };
};
