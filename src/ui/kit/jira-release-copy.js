/*
 * 8.6 — what the Jira release dialogs say, in ONE place (pure; test/jira-seal-flows.test.mjs pins it).
 *
 * A seal whose file is NOT on the issue (deleted and not put back) has only the app's copy left:
 * releasing it deletes that copy for good and the file can never be put back. The owner's dialog
 * always said so; the admin's force-release dialog said "anyone who can edit the issue can delete it",
 * which is false for a file that is already gone (bug 2). Both lost-row dialogs now carry the same
 * warning, and the deleted-issue copy on My work (Let it go) says it too.
 */
const name = (n) => `“${n}”`;

/** The issue panel's release confirmation (the owner's own seal). */
export function ownerReleaseCopy({ fileName, lost }) {
  return lost
    ? {
      title: "Let this file go?", confirmLabel: "Delete the copy", danger: true,
      message: `${name(fileName)} was deleted from the issue and could not be put back. Sentinel Vault's copy is the last one it holds; letting it go deletes that copy for good.`,
    }
    : {
      title: "Release this seal?", confirmLabel: "Release", danger: false,
      message: `Anyone who can edit the issue will be able to delete ${name(fileName)}, and Sentinel Vault will no longer put it back. The file stays on the issue; only Sentinel Vault's backup copy is deleted.`,
    };
}

/** The admin's force-release dialog (someone else's seal). */
export function forceReleaseCopy({ fileName, ownerName, lost }) {
  const owner = ownerName || "Someone else";
  const tell = `${ownerName || "The owner"} is mentioned in a comment if Sentinel Vault comments are on.`;
  return lost
    ? {
      title: "Force release and delete the copy", confirmLabel: "Delete the copy",
      message: `${owner} sealed ${name(fileName)}. It was deleted from the issue and could not be put back, so Sentinel Vault's copy is the last one it holds. Force releasing deletes that copy for good and the file cannot be put back. To keep the file, use Put it back instead. ${tell}`,
    }
    : {
      title: "Force release", confirmLabel: "Force release",
      message: `${owner} sealed ${name(fileName)}. Once released, anyone who can edit the issue can delete it and it will not be put back. ${tell}`,
    };
}

/** My work: letting go of the kept copy of a file whose issue was deleted. */
export function orphanLetGoCopy({ fileName, issueKey }) {
  return {
    title: "Let this file go?", confirmLabel: "Delete the copy", danger: true,
    message: `${issueKey || "The issue"} holding ${name(fileName)} was deleted. Sentinel Vault's copy is the last one it holds; letting it go deletes that copy for good. Download it first if you still need it.`,
  };
}
