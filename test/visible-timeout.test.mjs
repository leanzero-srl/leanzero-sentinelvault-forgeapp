// The sealed-section body's give-up timer counts only while the frame is on screen (device matrix
// 2026-10-07: sections below the fold gave up before the reader scrolled to them).
import { visibleTimeout } from "../src/ui/kit/visible-timeout.js";
import { eq, report } from "./_assert.mjs";

// fake clock + fake IntersectionObserver
const makeEnv = () => {
  let now = 0, seq = 0; const timers = new Map(); let observer = null;
  const setT = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
  const clearT = (id) => { timers.delete(id); };
  const advance = (ms) => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } };
  class IO { constructor(cb) { this.cb = cb; this.connected = true; observer = this; } observe() {} disconnect() { this.connected = false; } }
  const show = (v) => observer && observer.connected && observer.cb([{ isIntersecting: v }]);
  return { setT, clearT, advance, IO, show, pending: () => timers.size };
};

{ // off-screen: never expires, however long
  const e = makeEnv(); let fired = 0;
  visibleTimeout({ ms: 8000, target: {}, onExpire: () => fired++, IO: e.IO, setT: e.setT, clearT: e.clearT });
  e.show(false); e.advance(60000);
  eq("off-screen for a minute → not given up", fired, 0);
  e.show(true); e.advance(7999);
  eq("on screen 7.999 s → not yet", fired, 0);
  e.advance(1);
  eq("on screen 8 s → gives up once", fired, 1);
  e.show(false); e.show(true); e.advance(20000);
  eq("…and only once", fired, 1);
}
{ // scrolled away mid-wait: the countdown restarts when it comes back
  const e = makeEnv(); let fired = 0;
  visibleTimeout({ ms: 8000, target: {}, onExpire: () => fired++, IO: e.IO, setT: e.setT, clearT: e.clearT });
  e.show(true); e.advance(6000); e.show(false); e.advance(30000); e.show(true); e.advance(6000);
  eq("6 s + away + 6 s → not given up", fired, 0);
  e.advance(2000);
  eq("8 s in one stretch on screen → gives up", fired, 1);
}
{ // stop() before expiry
  const e = makeEnv(); let fired = 0;
  const stop = visibleTimeout({ ms: 8000, target: {}, onExpire: () => fired++, IO: e.IO, setT: e.setT, clearT: e.clearT });
  e.show(true); stop(); e.advance(20000);
  eq("stopped (the body rendered) → never fires", fired, 0);
  eq("…and no timer is left behind", e.pending(), 0);
}
{ // no IntersectionObserver → the old plain timeout
  const e = makeEnv(); let fired = 0;
  visibleTimeout({ ms: 8000, target: {}, onExpire: () => fired++, IO: undefined, setT: e.setT, clearT: e.clearT });
  e.advance(8000);
  eq("no IntersectionObserver → plain 8 s timeout", fired, 1);
}
report("visible-timeout");
