import { nextSelection, selectAll, clearAll, isAllOn } from "../src/ui/kit/activity-filter.js";
import { eq, report } from "./_assert.mjs";

const ALL = ["seals", "sections", "editreq", "workflow", "validation"];
eq("all on + click one → isolates it", nextSelection(ALL, "editreq", ALL), ["editreq"]);
eq("one on + click another → adds it (order follows ALL)", nextSelection(["editreq"], "seals", ALL), ["seals", "editreq"]);
eq("two on + click an on one → removes it", nextSelection(["seals", "editreq"], "seals", ALL), ["editreq"]);
eq("last one off → empty is allowed", nextSelection(["editreq"], "editreq", ALL), []);
eq("empty + click → that one", nextSelection([], "workflow", ALL), ["workflow"]);
eq("unknown id → unchanged", nextSelection(["seals"], "nope", ALL), ["seals"]);
eq("selectAll", selectAll(ALL), ALL);
eq("clearAll", clearAll(), []);
eq("isAllOn true", isAllOn(ALL, ALL), true);
eq("isAllOn false", isAllOn(["seals"], ALL), false);
eq("isAllOn empty universe false", isAllOn([], []), false);
report("activity-filter");
