import { useEffect, useState } from "react";
import { invoke } from "@forge/bridge";

/**
 * The viewer's edit-access status for every file sealed by SOMEONE ELSE, fetched by the list
 * (not by each card) so the list can group the files (kit/sealed-groups.js) and hand each card
 * its status — the card then skips its own check-edit-request.
 *
 * `source` is the list's state array: a reload replaces it, which re-reads every status.
 * @returns {{ statusById: object, ready: boolean }}
 */
export default function useEditStatuses(source) {
  const [statusById, setStatusById] = useState({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const others = (Array.isArray(source) ? source : []).filter((a) => a && a.lockStatus === "HELD" && !a.isStale);
    if (!others.length) { setStatusById({}); setReady(true); return undefined; }
    setReady(false);
    Promise.all(others.map((a) =>
      invoke("check-edit-request", { attachmentId: a.id })
        .then((r) => [a.id, { status: r?.status || "none", expiresAt: r?.expiresAt || null, retryAt: r?.retryAt || null, deniedReason: r?.deniedReason || null }])
        .catch(() => [a.id, { status: "none", expiresAt: null, retryAt: null }]),
    )).then((pairs) => {
      if (cancelled) return;
      setStatusById(Object.fromEntries(pairs));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [source]);
  return { statusById, ready };
}
