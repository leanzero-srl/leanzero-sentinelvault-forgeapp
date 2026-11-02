/*
 * ELZI'S TOURS FOR SENTINEL VAULT - DATA ONLY. A new tour is one entry here: steps + anchors, no new code.
 *
 * Two consoles, each with a PAGE tour and one MINI-TOUR per tab, all run by the one engine (Tour.jsx):
 *   site   the site settings page (a site admin): key "site", mini-tours "site-<tab>"
 *   space  the space's Sentinel Vault page (a space admin, or a member who has sealed files): key "space", "space-<tab>"
 * The page tour opens by itself on a person's first visit, Elzi says hello and whose guide she is. A tab's
 * mini-tour opens by itself on the first visit to that tab AFTER the page tour was finished (not skipped), never
 * straight after another tour. Every mark is the person's own (src/server/shared/nux.js).
 *
 * Anchors: a data-nux token on the element, or "@<testid>" (the control's data-testid). A step whose anchors are
 * not drawn is left out, so a tab with nothing to show yet loses that step, not the tour.
 * Words (human-speech rules): what the thing is and why it matters, then one small example, then what to do.
 * Plain sentences a person would say, no unexplained terms, no em or en dash. Budgets: tourSteps.js
 * (TOUR_BUDGET_S a tour, STEP_MAX_S a bubble).
 */
import { SITE_TABS, SPACE_TABS, nuxTabKey } from "./nux-tours.js";

// The bubble's buttons in the consoles' own classes (the app's own buttons).
export const CONSOLE_BTN = Object.freeze({ text: "btn-secondary", go: "btn-primary" });

const step = (id, anchors, face, title, text, extra = {}) => ({ id, anchors: [].concat(anchors), pose: "point", face, title, text, ...extra });

/* ── the site settings page ─────────────────────────────────────────────────────────────── */
export const SITE_STEPS = Object.freeze({
  settings: [
    step("protection", "grp-protection", "curious", "Protection",
      "This group decides what gets protected and who may step in. If someone removes a sealed image from a page, Sentinel Vault can put it back. Space admins can release a seal that isn't theirs, with a reason that is recorded."),
    step("expiry", "grp-expiry", "happy", "How long a seal lasts",
      "A seal holds a file for a set time, 48 hours unless you change it. Before it runs out, the owner gets a few reminders. You can also turn expiry off, and then a seal lasts until someone releases it."),
    step("alerts", "grp-alerts", "look", "Who hears about it",
      "Pop-ups and the page ribbon always work. Page comments that mention people are off by default, so nobody gets a surprise notification. Turn them on here if you want editors told when their change was undone."),
  ],
  validations: [
    step("what", "val-enable", "curious", "Content rules",
      "A validation checks a page each time it is saved. You might ask for a heading, a table or a label, or cap the length. Confluence can't stop a save, so the check runs right after it."),
    step("modes", "val-modes", "happy", "What happens to a page that fails",
      "Advisory leaves a comment listing what is missing. Gate marks the page passed or failed. Revert puts back the last good version, which can throw away someone's work, so choose it on purpose."),
    step("ai", "val-ai", "look", "AI review",
      "An AI can also read a page against your own instructions. It runs on Atlassian's own AI, so nothing leaves Atlassian. It is off until you turn it on, and a monthly allowance for the whole site caps what it can use."),
  ],
  classification: [
    step("what", "cls-status", "curious", "Page levels",
      "Classification shows a level, like Public or Confidential, under every page title. It starts off. Turning it off later keeps every level and default, so nothing is lost."),
    step("levels", ["cls-levels-editor", "@cls-provider-badge"], "happy", "The levels",
      "Each level has a rank, and rank 1 is the least sensitive. Rename them, change their colour, add your own, or import them from Jira Service Management Assets. Or use your site's own Confluence levels instead."),
    step("spaces", ["@cls-spaces-table", "@cls-spaces-empty"], "look", "A default per space",
      "A space can have a default level, so its pages start there. A page's own level wins over its space's. Lowering a level always asks for a reason, and the reason goes in the activity log."),
  ],
  api: [
    step("url", "api-url", "curious", "Do it by script",
      "Anything you set up here can also be done over REST: send settings, seal files, run checks. It is one endpoint, and it follows the same permissions as the screen."),
    step("tokens", "api-tokens", "happy", "Tokens",
      "A token lets a script call that endpoint as you. Its role limits it: Viewer changes nothing, Editor handles content, Admin handles everything. A token is shown once, so copy it when you make it."),
    step("jobs", "api-jobs", "look", "Recent jobs",
      "Every request leaves a receipt. This list shows the latest ones, so you can see what a script did and whether it worked."),
  ],
  backup: [
    step("status", "bk-status", "curious", "Your backup",
      "Sentinel Vault saves your setup after each change and once a day, to a Confluence page in a space you pick. If the app is ever removed, your settings are not lost."),
    step("restore", "bk-restore", "happy", "Restoring",
      "A restore shows you what comes back before it changes anything. Things that act on their own, like automations, come back paused, so nothing fires by surprise."),
    step("file", "bk-file", "look", "Export and import",
      "You can also export the whole setup as one file and import it later, for example to copy it to another site. Keep a copy somewhere safe."),
  ],
});

/* ── the space's Sentinel Vault page ────────────────────────────────────────────────────── */
export const SPACE_STEPS = Object.freeze({
  "my-claims": [
    step("what", "@rc-tab-my-claims", "curious", "Your sealed files",
      "Here are the files you have sealed in this space, and the edit requests you have made. A seal is yours until you release it or it runs out. After that the file is open to everyone again."),
    step("admin", "request-admin", "happy", "Want more control?",
      "If you look after this space, ask for admin access. A space admin approves it. If it is declined, you can ask again after 48 hours."),
  ],
  "locked-attachments": [
    step("what", "sealed-head", "curious", "Sealed files",
      "A seal locks a file so only its owner can change it, until it is released or runs out. If someone uploads a new version anyway, Sentinel Vault puts the sealed one back, and their version stays in the file's history."),
    step("force", "sealed-toolbar", "happy", "When the owner is away",
      "Pick the columns you want and sort the list here. If an owner is away, a row's Force release frees the file. You type a reason and it is recorded. It only shows while the site allows space admins to do it."),
  ],
  permissions: [
    step("quiet", "@sv-notifications-mode-card", "curious", "Quiet mode",
      "Normally Sentinel Vault posts a comment on the page that mentions the people involved. Set the space to Quiet and it posts none and mentions nobody. Pop-ups, the page ribbon and the activity log keep working."),
    step("admins", "admins-card", "happy", "Space admins",
      "Add people, or whole groups, as Sentinel Vault admins here. They can see every seal in this space and manage it. Requests for access wait in the next card for you to approve or deny."),
    step("class", "@sv-classification-card", "look", "Classification here",
      "If the site has classification on, you can switch it off for just this space, or pick a default level for its pages. Lowering that default asks for a reason."),
  ],
  "unlock-timeouts": [
    step("what", "@sv-row-useSiteDuration", "curious", "How long seals last here",
      "New seals follow the site's duration unless you set your own. Untick the box to give this space a duration in hours. A shorter time suits files that change often, a longer one suits slow reviews."),
    step("end", "@sv-row-useSiteDuration", "happy", "When time runs out",
      "The owner gets reminders first, and then the file is released. The reminders and the release follow the site settings, so you only choose how long a seal holds."),
  ],
  "macro-settings": [
    step("what", "grp-advanced", "curious", "The panel on pages",
      "The Sentinel Vault panel lists a page's files as Sealed or Available, with Seal and Release buttons. It can be added to a page the first time someone seals a file. A site admin holds the main switch. Here you choose to allow it in this space, and put it at the top or bottom."),
  ],
  validations: [
    step("what", "val-enable", "curious", "Rules for this space",
      "These checks run on pages in this space each time one is saved. Leave the list empty and the space follows the site's rules. Add your own and they replace the site's advisory rules, but a rule the site marks required always applies."),
    step("modes", "val-modes", "happy", "What happens to a page that fails",
      "Advisory leaves a comment, Gate marks the page passed or failed, and Revert puts back the last good version. A space can switch a way on, but it cannot switch off one the site turned on."),
    step("rules", "val-rules", "look", "Add a rule",
      "Press Add rule, pick a type such as a required heading or table, give it a label, and say whether it is advisory or required. Then save."),
  ],
  workflow: [
    step("what", "wf-enable", "curious", "Approval workflow",
      "With the workflow on, each page carries a state: Draft, In Review, Approved or Needs re-review. It shows on the page ribbon. Approved pages are protected, and you choose what happens when someone edits one."),
    step("approvers", "wf-approval", "happy", "Who approves",
      "Name the people or groups who can approve, and how many of them must say yes. Space admins can approve too. You can ask approvers to sign each decision with an authenticator code."),
  ],
  activity: [
    step("what", "@sv-activity-report", "curious", "The activity log",
      "Every seal, release, edit request, approval and classification change in this space is recorded here, with who did it and when. If someone asks why a file was released, the answer is in this list."),
    step("export", "@sv-activity-export", "happy", "Filter and export",
      "Narrow the list by period or by kind of event, load more as you go, and export it to a CSV file for an audit."),
  ],
});

const HELLO = "I'll show you around quickly.";
const MINI_HELLO = "I'll show you this page quickly.";

/** The mini-tour of one tab, or null. `role` = "steward" | "user" filters steps flagged for one of them. */
export const miniTourFor = (console_, tab) => {
  const steps = (console_ === "site" ? SITE_STEPS : SPACE_STEPS)[tab];
  if (!steps || !steps.length) return null;
  return { key: nuxTabKey(console_, tab), steps, ready: steps[0].anchors[0], intro: "first", hello: MINI_HELLO, replay: true };
};

/** A tab's mini-tour opens by itself only once the page tour was finished (AdminTours reads it from the marks). */
export const miniAutoStart = ({ pageTourDone = false } = {}) => !!pageTourDone;

/** The site page tour. */
export const siteTour = () => ({
  key: "site", intro: "always", hello: HELLO, ready: "site-head",
  steps: [
    step("what", "site-head", "happy", "This is Sentinel Vault",
      "Sentinel Vault protects files and sections on Confluence pages. When someone seals a file, nobody else can change it until it is released or the seal runs out. If someone does, their change is undone and they are told. You set the rules for the whole site here."),
    step("settings", "@tab-settings", "look", "Site settings",
      "These switches apply to every space: how long a seal lasts, who is told, what people may do from a page. A space admin can adjust some of them for one space. Changes only count once you press Apply."),
    step("again", ["site-tour-btn", "tab-tour"], "happy", "See this again",
      "Press Take the tour any time. Each tab also has its own Tour button.",
      { textBy: { "tab-tour": "Each tab has a Tour button like this one. Press it any time." } }),
  ],
});

/** The space page tour. A space admin and a plain member see different tabs, so their steps differ. */
export const spaceTour = ({ steward = false } = {}) => ({
  key: "space", intro: "always", hello: HELLO, ready: "space-head",
  steps: [
    step("what", "space-head", "happy", "Sentinel Vault in this space",
      "This is where you look after sealed files in this space. A seal keeps a file safe from other people's edits until it is released or runs out."),
    steward
      ? step("files", "@rc-tab-locked-attachments", "look", "Every sealed file",
        "Every sealed file in the space is listed here. If an owner is away and a file is stuck, you can release their seal. You will be asked for a reason, and it is recorded.")
      : step("files", "@rc-tab-my-claims", "look", "Your sealed files",
        "These are the files you have sealed in this space, and the edit requests you have made. To manage everyone's seals, ask a space admin for access."),
    steward && step("access", "@rc-tab-permissions", "surprised", "Who manages this space",
      "Add people or groups as Sentinel Vault admins for this space, approve requests for access, and set the space to Quiet so it posts no comments."),
    step("again", ["space-tour-btn", "tab-tour"], "happy", "See this again",
      "Press Take the tour any time. Each tab also has its own Tour button.",
      { textBy: { "tab-tour": "Each tab has a Tour button like this one. Press it any time." } }),
  ].filter(Boolean),
});

export const allTours = () => [
  siteTour(), spaceTour({ steward: true }), spaceTour({ steward: false }),
  ...SITE_TABS.map((t) => miniTourFor("site", t)).filter(Boolean),
  ...SPACE_TABS.map((t) => miniTourFor("space", t)).filter(Boolean),
];
