import { asApp, asUser, route } from "@forge/api";

import { authorizeSteward } from "./steward-checks.js";

/**
 * SV-SEC-1 — the missing primitive: "may THIS caller edit THIS page?"
 *
 * The house already had space-scoped steward checks (shared/steward-checks.js) and
 * record-owner checks (unsealSection / refreshSectionSnapshot). Neither answers the seal
 * question: at seal time there is no record to own, so the test has to be the caller's
 * entitlement to the TARGET PAGE itself.
 *
 * Layering — one load-bearing arm, two depth arms:
 *   L2a (LOAD-BEARING) asApp content-permission check that NAMES the caller as subject, so the
 *        answer is per-account and works in a resolver, a trigger and a web trigger alike.
 *        Confluence folds site permissions, space permissions AND content restrictions into it.
 *        An affirmative answer is trusted ONLY after a control probe proves the same endpoint,
 *        on the same page, still returns NO for a subject that must not hold `update`.
 *   L2b (DEPTH) asUser page-operations read. No subject parameter, so it can neither be aimed at
 *        another account nor report the app's own rights. Consulted ONLY when the ambient Forge
 *        user is provably the declared caller.
 *   L2c (DEPTH) steward of the page's OWN resolved realm — keeps seal consistent with unseal,
 *        which already grants stewards, without ever consulting a caller-supplied space.
 *
 * Every probe is tri-state (true | false | null). null NEVER allows. A gate that cannot decide
 * must not permit.
 */

const PAGE_ID_SHAPE = /^[0-9]{1,19}$/;
const PROBE_RETRY_DELAY_MS = 400;

// A subject that cannot hold `update` on a Confluence Cloud page. `anonymous` is a documented
// identifier for type=user (see PermissionSubjectWithGroupId in the v1 spec). If the endpoint
// answers TRUE for this, it is not discriminating and its TRUE for the real caller is worthless.
const CONTROL_SUBJECT = "anonymous";

/**
 * Probe outcomes. These are deliberately FOUR values, not a boolean.
 *
 * The distinction that matters is DENY vs NO_SUBJECT. Both mean "not permitted", so both deny —
 * but only DENY is evidence that the endpoint actually evaluated the subject against the page.
 * Collapsing them (the earlier code mapped HTTP 404 straight to `false`) made the control probe
 * satisfiable by a non-answer: `anonymous` is not an accountId, Confluence answers 404 "no such
 * user", that became `false`, and the control reported "yes, it discriminates" without ever having
 * seen the endpoint deny anybody. A control that cannot fail is not a control.
 */
const PROBE_ALLOW = "allow";
const PROBE_DENY = "deny";
const PROBE_NO_SUBJECT = "no-subject";
const PROBE_UNKNOWN = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One asApp GET with a single retry for the transient statuses only (429 / 5xx). Returns the
 * Response, or null when there was no usable answer.
 *
 * A blocking call on the gate's critical path must not turn a rate-limit into a refusal on its
 * first try: this app is already REST-heavy per page (triggers.js caps its probes for exactly that
 * reason), so 429 is a live condition on a busy tenant, not a hypothetical. Retrying a non-answer
 * can only ever turn it into an answer — it can never turn a NO into a YES.
 */
async function getWithTransientRetry(routeValue, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await asApp().requestConfluence(routeValue);
    } catch (e) {
      console.error(`[PAGE-ACCESS] ${label} threw:`, e);
      return null;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 0) { await sleep(PROBE_RETRY_DELAY_MS); continue; }
      console.error(`[PAGE-ACCESS] ${label} unavailable (${res.status}) after retry`);
      return null;
    }
    return res;
  }
  return null;
}

export function isPlausiblePageId(value) {
  if (value == null) return false;
  const t = typeof value;
  if (t !== "string" && t !== "number") return false;
  return PAGE_ID_SHAPE.test(String(value));
}

/**
 * Resolve a page's TRUE realm from its id. A page id names exactly one space, and that is the
 * only space whose stewards may be consulted about it.
 *
 * v2 ONLY. The v1 content GET (`/wiki/rest/api/content/{id}?expand=space`) is sunset and returns
 * HTTP 410 Gone for Forge apps — that is the B11 incident recorded in
 * capsules/validations/actions.js, where it silently denied EVERY steward in production.
 *
 * @returns {Promise<{spaceId:string, spaceKey:string|null, title:string|null}|null>}
 *          null = the realm could not be established, so the caller MUST fail closed.
 */
export async function resolvePageRealm(pageId) {
  if (!isPlausiblePageId(pageId)) return null;
  try {
    // Both GETs retry the transient statuses. This call BLOCKS the gate — a caller the gate would
    // otherwise allow gets refused when it returns null — so a single 429 must not be able to
    // refuse a legitimate seal. It stays AHEAD of the gate regardless: the realm is an input to the
    // decision, not a consequence of it.
    const pres = await getWithTransientRetry(route`/wiki/api/v2/pages/${pageId}`, `page read ${pageId}`);
    if (!pres || !pres.ok) {
      if (pres) console.error(`[PAGE-ACCESS] page read ${pageId} -> ${pres.status}`);
      return null;
    }
    const page = await pres.json();
    const spaceId = page?.spaceId;
    if (!spaceId) {
      console.error(`[PAGE-ACCESS] page ${pageId} returned no spaceId`);
      return null;
    }
    let spaceKey = null;
    const sres = await getWithTransientRetry(route`/wiki/api/v2/spaces/${spaceId}`, `space read ${spaceId}`);
    if (sres && sres.ok) spaceKey = (await sres.json())?.key || null;
    else console.warn(`[PAGE-ACCESS] space read ${spaceId} -> ${sres ? sres.status : "no answer"} (steward arm unavailable)`);
    return { spaceId: String(spaceId), spaceKey, title: page?.title || null };
  } catch (e) {
    console.error("[PAGE-ACCESS] resolvePageRealm threw:", e);
    return null;
  }
}

/**
 * One content-permission probe. true | false | null (null = no usable answer).
 *
 * POST /wiki/rest/api/content/{id}/permission/check
 *   { "subject": { "type": "user", "identifier": "<accountId|anonymous>" }, "operation": "update" }
 * `operation` is a BARE STRING enum ("read" | "update" | "delete") per ContentPermissionRequest —
 * NOT a nested {operation,targetType} object. 200 -> { hasPermission, errors[] }.
 * Scopes read:confluence-content.permission and read:content.permission:confluence are already
 * declared in manifest.yml — no new scope, no re-consent during certification.
 *
 * Note this is the v1 *sub-resource*, which is NOT part of the sunset v1 content GET family.
 */
async function contentPermissionProbe(pageId, subjectIdentifier, operation) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await asApp().requestConfluence(
        route`/wiki/rest/api/content/${pageId}/permission/check`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: { type: "user", identifier: subjectIdentifier },
            operation,
          }),
        },
      );
    } catch (e) {
      console.error(`[PAGE-ACCESS] content permission check threw (page ${pageId}):`, e);
      return PROBE_UNKNOWN;
    }

    // Retry ONLY "we got no answer". This can turn a non-answer into an answer; it can never
    // turn a NO into a YES.
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 0) { await sleep(PROBE_RETRY_DELAY_MS); continue; }
      console.error(`[PAGE-ACCESS] content permission check unavailable (${res.status}) page ${pageId}`);
      return PROBE_UNKNOWN;
    }

    if (res.status === 200) {
      let data = null;
      try { data = await res.json(); } catch (_) { return PROBE_UNKNOWN; }
      if (typeof data?.hasPermission !== "boolean") {
        console.error(`[PAGE-ACCESS] content permission check returned no hasPermission for page ${pageId}`);
        return PROBE_UNKNOWN;
      }
      if (data.hasPermission === true) return PROBE_ALLOW;
      const why = (data.errors || [])
        .map((err) => err?.key || err?.message?.translation)
        .filter(Boolean);
      if (why.length) console.info(`[PAGE-ACCESS] deny ${subjectIdentifier} on ${pageId}: ${why.join("; ")}`);
      // A 200 that says hasPermission:false is the ONLY outcome that proves the endpoint weighed
      // this subject against this page and said no.
      return PROBE_DENY;
    }

    // 404 = no such content, and — observed live — no such user. That is a NON-ANSWER about
    // entitlement, distinct from a denial, even though both refuse. Kept separate so the control
    // probe cannot be satisfied by "that subject does not exist".
    if (res.status === 404) return PROBE_NO_SUBJECT;
    // 400/401/403 = the check itself was refused or malformed. Not an entitlement either.
    console.error(`[PAGE-ACCESS] content permission check ${pageId} -> ${res.status}`);
    return PROBE_UNKNOWN;
  }
  return PROBE_UNKNOWN;
}

/**
 * Tri-state view of the probe, for the SUBJECT arm. true | false | null.
 * NO_SUBJECT folds into false: it never allows, exactly as before. Only the control probe needs
 * the finer distinction, and it reads the raw outcome.
 */
async function contentPermissionCheck(pageId, subjectIdentifier, operation) {
  const outcome = await contentPermissionProbe(pageId, subjectIdentifier, operation);
  if (outcome === PROBE_ALLOW) return true;
  if (outcome === PROBE_DENY || outcome === PROBE_NO_SUBJECT) return false;
  return null;
}

/**
 * The control. It must observe the endpoint DEFINITELY DENYING somebody on THIS page — a 200
 * carrying hasPermission:false — before any affirmative answer from it is trusted.
 *
 * `anonymous` cannot hold `update` on a Confluence Cloud page (anonymous access is view-only), so
 * a discriminating endpoint denies it. What this must NOT accept is a 404: `anonymous` is not an
 * accountId, and if Confluence answers "no such user" then the control has learned nothing about
 * whether the endpoint evaluates subjects at all. The earlier version accepted that 404 as proof,
 * which made the control structurally incapable of failing.
 *
 * Returns false on ANY outcome other than a definite deny, so the gate fails CLOSED and says so
 * loudly. Closed here does not mean "nobody can seal": the as-user arm (L2b) and the steward arm
 * (L2c) still decide, and in a resolver — which is the only place sealSection runs — L2b is
 * always available. The load-bearing arm simply stops being load-bearing until its control passes.
 */
async function endpointDiscriminates(pageId) {
  const outcome = await contentPermissionProbe(pageId, CONTROL_SUBJECT, "update");
  if (outcome === PROBE_DENY) return true;
  console.error(
    `[PAGE-ACCESS] CONTROL INCONCLUSIVE on page ${pageId}: control subject "${CONTROL_SUBJECT}" ` +
    `returned "${outcome}", not a definite deny. The content-permission arm cannot be trusted here.`,
  );
  return false;
}

/**
 * L2a — the load-bearing arm, carrying its own control. The subject probe and the control run
 * together, so an affirmative answer is only ever trusted when the SAME endpoint, on the SAME
 * page, demonstrably still says NO to a subject that cannot hold the right.
 */
async function probeAppMayOperate(accountId, pageId, operation) {
  const [subject, discriminates] = await Promise.all([
    contentPermissionCheck(pageId, accountId, operation),
    endpointDiscriminates(pageId),
  ]);
  if (subject !== true) return subject; // false or null — no control needed to deny
  if (!discriminates) {
    console.error(
      `[PAGE-ACCESS] CONTROL FAILED on page ${pageId} — the endpoint was not observed definitively ` +
      "denying the control subject, so its affirmative answer for the caller is not trusted. " +
      "Returning indeterminate; the as-user and steward arms decide.",
    );
    return null;
  }
  return true;
}

/**
 * The ambient Forge user, or null when there is no asUser context (trigger / scheduled / web
 * trigger) or consent is missing. Also carries the display name/email sealSection records, so
 * the gate does not add a call the handler was already making.
 */
export async function resolveAmbientUser() {
  try {
    const r = await asUser().requestConfluence(route`/wiki/rest/api/user/current`);
    if (!r.ok) return null;
    const d = await r.json();
    return {
      accountId: d?.accountId || null,
      displayName: d?.displayName || null,
      email: d?.email || null,
    };
  } catch (_) {
    return null; // no asUser context here — indeterminate, never allow
  }
}

/**
 * L2b — DEPTH. GET /wiki/api/v2/pages/{id}/operations as the ambient user.
 * No subject parameter, so the answer is always about whoever Forge authenticated: it cannot be
 * aimed at another account and cannot report the app's own rights. Scope read:page:confluence is
 * already in manifest.yml.
 */
async function probeUserMayUpdatePage(pageId) {
  try {
    const res = await asUser().requestConfluence(route`/wiki/api/v2/pages/${pageId}/operations`);
    if (res.status === 200) {
      const ops = (await res.json())?.operations || [];
      return ops.some((o) => o?.operation === "update" && o?.targetType === "page");
    }
    if (res.status === 404) return false; // documented: cannot view the page, or it is absent
    console.warn(`[PAGE-ACCESS] page operations ${pageId} -> ${res.status}`);
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * The gate. Allows ONLY on an affirmative answer from an arm that actually ran and returned a
 * definite verdict. A broken probe, an unknown account, an unresolvable page and a missing user
 * context all DENY.
 *
 * @param {{accountId:string, pageId:string|number, realmKey:string|null}} args
 * @returns {Promise<{allowed:boolean, decidedBy:string, app:boolean|null, user:boolean|null,
 *                    steward:boolean, indeterminate:boolean,
 *                    ambient:{accountId:string|null,displayName:string|null,email:string|null}|null}>}
 */
export async function authorizePageEdit({ accountId, pageId, realmKey }) {
  const verdict = {
    allowed: false,
    decidedBy: "denied",
    app: null,
    user: null,
    steward: false,
    indeterminate: false,
    ambient: null,
  };

  if (!accountId || !isPlausiblePageId(pageId)) {
    verdict.decidedBy = "bad-input";
    return verdict;
  }

  verdict.app = await probeAppMayOperate(accountId, pageId, "update");
  if (verdict.app === true) {
    verdict.allowed = true;
    verdict.decidedBy = "content-permission(asApp)";
    return verdict;
  }

  // Bind the as-user arm to the declared caller. req.context.accountId and the ambient asUser
  // identity are the same principal in a resolver, but this arm must never be able to launder one
  // account's entitlement into a decision about another, so it only runs when they provably match.
  verdict.ambient = await resolveAmbientUser();
  if (verdict.ambient?.accountId && verdict.ambient.accountId === accountId) {
    verdict.user = await probeUserMayUpdatePage(pageId);
    if (verdict.user === true) {
      verdict.allowed = true;
      verdict.decidedBy = "page-operations(asUser)";
      return verdict;
    }
  } else if (verdict.ambient?.accountId) {
    console.warn(
      `[PAGE-ACCESS] ambient user ${verdict.ambient.accountId} != declared caller ${accountId} ` +
      "— as-user arm skipped",
    );
  }

  // L2c — steward of THIS page's OWN realm (resolved from the page id, never caller-supplied).
  // A steward already administers the page, and unsealSection already grants them; refusing here
  // would make a seal creatable by someone who cannot remove it.
  if (realmKey) {
    try {
      verdict.steward = await authorizeSteward(accountId, realmKey);
    } catch (e) {
      console.error("[PAGE-ACCESS] steward check threw:", e);
      verdict.steward = false;
    }
    if (verdict.steward) {
      verdict.allowed = true;
      verdict.decidedBy = "steward";
      return verdict;
    }
  }

  if (verdict.app === null && verdict.user === null) {
    // Both entitlement arms failed to answer. Deny — but LOUDLY and distinguishably. A silent
    // fail-closed that denies everyone is exactly the B11 outage shape.
    verdict.indeterminate = true;
    verdict.decidedBy = "indeterminate";
    console.error(
      `[PAGE-ACCESS] DENY(probe-failure) page=${pageId} account=${accountId} — no entitlement arm returned a verdict`,
    );
  }
  return verdict;
}

/**
 * THE CLASS GATE. Every resolver that performs a privileged (asApp) write to a CALLER-SUPPLIED
 * pageId must call this before it touches Confluence or KVS, and must return `refusal` when set.
 *
 * SV-SEC-1 was not one broken resolver, it was a class: `src/server/registry.js` flattens every
 * capsule's actions into ONE @forge/resolver, so any authenticated invoker can call any key from
 * any surface. Gating a single resolver leaves the other doors on the same router open. This
 * helper exists so the gate is written ONCE — a per-resolver copy of the logic is how one of them
 * ends up subtly weaker than the rest.
 *
 * Deliberately NOT a router-level wrapper: many resolvers legitimately take a pageId for a READ,
 * and an implicit wrapper that guessed which ones were writes would be both fragile and invisible
 * at the call site. An explicit line in each writing resolver is auditable by grep.
 *
 * @param {object} req         the resolver request (for context accountId / extension pageId)
 * @param {string|number} pageId  the page the resolver is about to write to
 * @param {string} tag         log prefix, e.g. "PANEL inject-panel"
 * @returns {Promise<{refusal:object|null, realm:object|null, verdict:object|null}>}
 *          refusal non-null = REFUSE, return it verbatim to the caller.
 */
export async function guardPageWrite(req, pageId, tag) {
  const accountId = req?.context?.accountId;
  const ctxPageId = req?.context?.extension?.content?.id;
  const payloadPageId = req?.payload?.pageId;

  // Depth, not the gate. Where the caller carries a genuine extension context, payload and context
  // must agree — that removes the "aim it at any page" primitive outright for such callers. A
  // caller that sends no context simply falls through to the entitlement check below.
  if (ctxPageId && payloadPageId && String(payloadPageId) !== String(ctxPageId)) {
    console.warn(`[${tag}] refused: payload pageId ${payloadPageId} != context pageId ${ctxPageId} (account ${accountId})`);
    return { refusal: { success: false, reason: "Page mismatch — reopen the panel and try again" }, realm: null, verdict: null };
  }

  if (!isPlausiblePageId(pageId)) {
    return { refusal: { success: false, reason: "Invalid pageId" }, realm: null, verdict: null };
  }
  if (!accountId) {
    console.error(`[${tag}] refused: no caller accountId in context`);
    return {
      refusal: { success: false, reason: "Could not identify you — reload and try again" },
      realm: null, verdict: null,
    };
  }

  // The realm comes from the PAGE, never from the caller's extension context, so a caller cannot
  // nominate the space whose stewards get consulted about a page they do not own.
  const realm = await resolvePageRealm(pageId);
  if (!realm) {
    console.error(`[${tag}] refused: could not resolve the realm of page ${pageId}`);
    return {
      refusal: { success: false, reason: "Could not verify this page — try again" },
      realm: null, verdict: null,
    };
  }

  const verdict = await authorizePageEdit({ accountId, pageId, realmKey: realm.spaceKey });
  if (!verdict.allowed) {
    console.warn(
      `[${tag}] DENIED page=${pageId} account=${accountId} by=${verdict.decidedBy} ` +
      `app=${verdict.app} user=${verdict.user} steward=${verdict.steward}`,
    );
    return {
      refusal: verdict.indeterminate
        ? { success: false, reason: "Could not verify your permission on this page — try again" }
        : { success: false, reason: "You do not have permission to edit this page" },
      realm, verdict,
    };
  }
  return { refusal: null, realm, verdict };
}

/**
 * Read-side sibling, for the same caller-supplied-pageId + asApp-read pattern that
 * listPageHeadings and enumerateSectionSeals have. Exported and ready; NOT wired in by this
 * change — that is a separate disclosure from SV-SEC-1's write defect and belongs in its own
 * commit with its own negative test.
 */
export async function authorizePageRead({ accountId, pageId }) {
  if (!accountId || !isPlausiblePageId(pageId)) return false;
  return (await probeAppMayOperate(accountId, pageId, "read")) === true;
}
