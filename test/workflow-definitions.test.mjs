// B1 — the pure halves of the definition editor and label-scoped workflows.
import { validateDefinition, chooseWorkflowForLabels, sanitizeLabelWorkflows, WORKFLOW_COLORS, DEFAULT_WORKFLOW } from "../src/server/capsules/workflow/logic.js";
import { eq, ok, report } from "./_assert.mjs";

const good = { id: "default", name: "Doc", states: [{ id: "draft", name: "Draft", initial: true }, { id: "qa", name: "QA", color: "caution", reviewAfterDays: "10" }, { id: "done", name: "Done", enforce: true }], transitions: [{ from: "draft", to: "qa" }, { from: "qa", to: "done" }, { from: "qa", to: "qa" }, { from: "qa", to: "done" }] };
const v = validateDefinition(good);
ok("a sound definition validates", v.ok);
eq("…normalised: self-loop and duplicate edge dropped", v.value.transitions, [{ from: "draft", to: "qa" }, { from: "qa", to: "done" }]);
eq("…reviewAfterDays parsed to an int", v.value.states[1].reviewAfterDays, 10);
eq("…unknown colour → neutral", v.value.states[0].color, "neutral");
ok("the built-in default validates", validateDefinition(DEFAULT_WORKFLOW).ok);
ok("no states → refused", !validateDefinition({ states: [] }).ok);
ok("two initial states → refused", !validateDefinition({ states: [{ id: "a", name: "A", initial: true }, { id: "b", name: "B", initial: true }] }).ok);
ok("no initial state → refused", !validateDefinition({ states: [{ id: "a", name: "A" }] }).ok);
ok("duplicate id → refused", !validateDefinition({ states: [{ id: "a", name: "A", initial: true }, { id: "a", name: "A2" }] }).ok);
ok("bad id → refused", !validateDefinition({ states: [{ id: "In Review", name: "x", initial: true }] }).ok);
ok("empty name → refused", !validateDefinition({ states: [{ id: "a", name: "  ", initial: true }] }).ok);
ok("transition to an unknown state → refused", !validateDefinition({ states: [{ id: "a", name: "A", initial: true }], transitions: [{ from: "a", to: "ghost" }] }).ok);
ok("negative review days → refused", !validateDefinition({ states: [{ id: "a", name: "A", initial: true, reviewAfterDays: -1 }] }).ok);
ok("21 states → refused", !validateDefinition({ states: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, initial: i === 0 })) }).ok);
ok("bad workflow id → refused", !validateDefinition({ id: "Fast Track!", states: [{ id: "a", name: "A", initial: true }] }).ok);
eq("colours list", WORKFLOW_COLORS, ["neutral", "info", "success", "caution", "critical"]);

const lws = [{ workflowId: "fast", labels: ["urgent"], priority: 10 }, { workflowId: "legal", labels: ["contract", "urgent"], priority: 20 }, { workflowId: "zero", labels: ["urgent"], priority: 0 }];
eq("no matching label → null (the default)", chooseWorkflowForLabels(lws, ["misc"]), null);
eq("one match", chooseWorkflowForLabels(lws, ["contract"]), "legal");
eq("two matches → highest priority", chooseWorkflowForLabels(lws, ["urgent"]), "legal");
eq("labels compare case-insensitively", chooseWorkflowForLabels(lws, ["URGENT"]), "legal");
eq("tie keeps the earlier entry", chooseWorkflowForLabels([{ workflowId: "a", labels: ["x"], priority: 5 }, { workflowId: "b", labels: ["x"], priority: 5 }], ["x"]), "a");
eq("empty config → null", chooseWorkflowForLabels([], ["x"]), null);

eq("sanitize: bad ids, 'default' and duplicates dropped; labels lowercased; priority bounded", sanitizeLabelWorkflows([{ workflowId: "fast", labels: ["Urgent", "urgent", "bad label!"], priority: "5000" }, { workflowId: "default", labels: ["x"] }, { workflowId: "fast", labels: ["y"] }, { workflowId: "Bad Id" }]),
  [{ workflowId: "fast", name: null, labels: ["urgent"], priority: 1000 }]);
eq("sanitize: non-array → []", sanitizeLabelWorkflows(null), []);
report("workflow-definitions");
