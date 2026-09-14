import { decideSectionRetry, nextRetryMarker, sectionRetryKey, SECTION_RETRY_PREFIX } from "../src/server/shared/section-retry.js";
import { eq, ok, report } from "./_assert.mjs";

// when to set the marker
eq("gap2: section restore pending + no confirmed write → retry", decideSectionRetry({ sectionChanged: true, anyChange: false }), true);
eq("gap2: section restore pending + confirmed write → no retry", decideSectionRetry({ sectionChanged: true, anyChange: true }), false);
eq("gap2: no section change + no write (clean page) → no retry", decideSectionRetry({ sectionChanged: false, anyChange: false }), false);
eq("gap2: media-only change that failed to write is not a section retry", decideSectionRetry({ sectionChanged: false, anyChange: false }), false);
eq("gap2: undefined flags → no retry", decideSectionRetry({}), false);

// marker value
const first = nextRetryMarker(null, 123, "2026-09-14T10:00:00.000Z");
eq("gap2: first marker", first, { pageId: "123", since: "2026-09-14T10:00:00.000Z", attempts: 1 });
const second = nextRetryMarker(first, 123, "2026-09-14T11:00:00.000Z");
eq("gap2: second marker keeps since, bumps attempts", second, { pageId: "123", since: "2026-09-14T10:00:00.000Z", attempts: 2 });
eq("gap2: a corrupt prior marker restarts the count", nextRetryMarker({ since: 5, attempts: "x" }, "9", "T").attempts, 1);
ok("gap2: key uses the prefix the sweep queries", sectionRetryKey("42") === `${SECTION_RETRY_PREFIX}42`);

report("section-retry");
