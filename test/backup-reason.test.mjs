// The Backup tab never shows a raw reason key (7.0.0 live check: "approve-edit-request", "privacy").
import { eq, ok, report } from "./_assert.mjs";
import { backupReasonText } from "../src/ui/kit/backup-reason.js";
import { readFileSync } from "node:fs";
eq("privacy backups read in plain words", backupReasonText("privacy"), "after the personal-data check");
eq("a resolver key reads 'after a change'", backupReasonText("approve-edit-request"), "after a change");
eq("REST bundle", backupReasonText("rest-bundle"), "after a change over REST");
eq("daily", backupReasonText("schedule"), "daily");
eq("no reason → nothing", backupReasonText(undefined), "");
const tab = readFileSync(new URL("../src/ui/kit/BackupTab.jsx", import.meta.url), "utf8");
ok("the tab uses the shared helper everywhere", !/REASON\[/.test(tab) && (tab.match(/backupReasonText\(/g) || []).length >= 2);
report("backup-reason");
