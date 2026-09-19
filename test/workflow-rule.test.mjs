// WF-11: the one-sentence effective rule at the top of the Workflow tab.
import { eq, ok, report } from "./_assert.mjs";
import { workflowRuleSentence } from "../src/ui/kit/workflow-rule.js";
import { DEFAULT_WORKFLOW } from "../src/server/capsules/workflow/logic.js";

const mihai = { type: "user", id: "m", name: "Mihai Perdum" };
const gabi = { type: "user", id: "g", name: "Gabriela Perdum" };

eq("off", workflowRuleSentence({ enabled: false }, DEFAULT_WORKFLOW), "The workflow is off in this space: pages carry no state.");
eq("the critique's example", workflowRuleSentence({ enabled: true, autoAssignNew: true, approval: { approvers: [mihai], mode: "any" }, enforceMode: "demote", demoteTo: "initial" }, DEFAULT_WORKFLOW),
  "New pages start in Draft. Mihai Perdum approves before a page is Approved. Approved pages are protected: an edit by anyone who is not an approver or a space admin moves the page back to Draft. Re-review after 150 days.");
ok("two approvers, any", /Any one of Mihai Perdum and Gabriela Perdum approves/.test(workflowRuleSentence({ enabled: true, approval: { approvers: [mihai, gabi], mode: "any" } }, DEFAULT_WORKFLOW)));
ok("all", /All of Mihai Perdum and Gabriela Perdum approve/.test(workflowRuleSentence({ enabled: true, approval: { approvers: [mihai, gabi], mode: "all" } }, DEFAULT_WORKFLOW)));
ok("min", /At least 2 of/.test(workflowRuleSentence({ enabled: true, approval: { approvers: [mihai, gabi], mode: "min", min: 2 } }, DEFAULT_WORKFLOW)));
ok("approval on with nobody → the space-admin truth is stated", /No approvers are set, so only a space admin/.test(workflowRuleSentence({ enabled: true, approval: { approvers: [], mode: "any" } }, DEFAULT_WORKFLOW)));
ok("approval off → only a space admin", /Only a space admin can move a page to Approved/.test(workflowRuleSentence({ enabled: true, approval: null }, DEFAULT_WORKFLOW)));
ok("revert mode", /is undone \(the approved version is restored\)/.test(workflowRuleSentence({ enabled: true, enforceMode: "revert" }, DEFAULT_WORKFLOW)));
ok("demote to a named state", /moves the page back to In Review/.test(workflowRuleSentence({ enabled: true, enforceMode: "demote", demoteTo: "in_review" }, DEFAULT_WORKFLOW)));
ok("the setting's clock wins", /Re-review after 90 days/.test(workflowRuleSentence({ enabled: true, reviewAfterDays: 90 }, DEFAULT_WORKFLOW)));
ok("not auto-started → 'Pages start'", /^Pages start in Draft\./.test(workflowRuleSentence({ enabled: true, autoAssignNew: false }, DEFAULT_WORKFLOW)));
ok("no definition → no crash", /Pages start at the workflow's first state\./.test(workflowRuleSentence({ enabled: true }, null)));

report("workflow-rule");
