# Troubleshooting

Common issues and solutions for Sentinel Vault.

## Installation and Deployment

**App not appearing after install:**
Ensure you ran `npm run build` before `forge deploy`. Check that the `static/` directory contains the 9 surface bundles: `page-details`, `inline-panel`, `section-setup`, `overlay`, `doc-ribbon`, `my-work`, `steward-console`, `realm-console`, `panel-setup`.

**Build failures:**
Run `npm run lint` to check for syntax errors. Use Node.js 22.x to match the `nodejs22.x` runtime in `manifest.yml`.

**Permission errors on deploy:**
Verify your Forge CLI authentication with `forge whoami`. Re-authenticate with `forge login` if needed. Ensure your Atlassian account has developer access.

**Tunnel not connecting:**
Ensure only one tunnel is running at a time. Kill any existing tunnel processes (`ps aux | grep tunnel`) and retry with `forge tunnel`.

**Frontend changes not visible after deploy:**
Run `npm run build` before `forge deploy`. The deploy command uploads the contents of `static/`, so stale bundles will show outdated UI.

## Sealing and Protection

**Seal not protecting the file:**
Check if the seal has expired (status shows "Overdue"). If expiry notifications are enabled, expired seals are auto-released. Verify the seal is still active in the page-details modal (the chip under the page title) or the inline panel.

**Automatic reversion not happening:**
- Check `forge logs` for errors in the `artifactEventTrigger` handler
- Verify the `app-account-id` KVS key is populated (used for loop prevention). If missing, the app may be reverting its own restores
- Ensure the attachment event trigger is registered in `manifest.yml`

**Content protection not working (sealed images being removed from pages):**
- Verify the **Protect Sealed Attachments in Page Body** setting is enabled (Site settings → Settings → Protection)
- Check `forge logs` for errors in the `pageContentTrigger` handler
- Content protection uses ADF comparison between page versions -- if the page has no prior version, protection cannot activate

**Seal shows "Overdue" but is not released:**
Either **Seals expire** is off (Site settings → Settings → Expiry), so seals persist until released, or the seal is inside its overdue reminders: with seals expiring, the owner gets **Overdue reminders before release** (default 3) spaced by **Hours between overdue reminders** (default 24) before the release. 0 reminders reminds once and holds the seal.

**Auto-insert macro not adding the panel to pages:**
Both conditions must be met:
1. **Auto-Insert Macro on Seal** must be enabled (Site settings → Settings → Advanced)
2. The space must not have explicitly disabled auto-insert in its Macro settings

## Notifications

**Comment notifications not appearing:**
1. The app has no email service — a "notification" is a Confluence footer comment that @mentions the recipient; Confluence itself decides whether to email them (their personal notification preferences).
2. Check that **Page comments that mention people** is on (Site settings → Settings → Alerts). It is OFF by default. Only **Tell editors when their change is undone** works without it.
3. Check that the specific comment sub-type is also enabled, and that the space is not in **Quiet** mode (space console → Access Control).
4. Check `forge logs` for `[NOTICE]` (preparing the notice) and `[NOTIFY]` (posted / retry / failed / suppressed) log lines.
5. The recipient must be able to read the page; Confluence drops mentions for users without access.

**Duplicate comment notifications:**
Check if deduplication keys are being written correctly. The system uses KVS keys like `expiry-notified-{artifactId}` and `fifty-percent-reminder-sent-{artifactId}` to prevent duplicates. If these keys are being cleared prematurely, duplicates may occur.

**Toast notifications not appearing:**
- Verify **Pop-up messages** is on (Site settings → Settings → Alerts)
- Toast notifications rely on the Forge Bridge `showFlag` API -- they may not appear if the page refreshes immediately after the action (e.g., during reversion)
- Check browser console for errors related to `showFlag`

**Page comments not being posted:**
- Violation comments need both **Page comments that mention people** and **Violation comments** on; both are off by default
- Check that the app has `write:comment:confluence` permission
- Check `forge logs` for comment posting errors

**Watch notifications not received:**
- Ensure you clicked **Watch** on the attachment (button shows "Watching" when active)
- Watch notifications are only sent when the seal is actually released (manual, expiry, or space admin override)
- The watch notice is a page comment, so **Page comments that mention people** must be on and the space must not be Quiet

## Administration

**Force release not offered:**
In the page-details modal and the inline panel, **Force release…** appears under a sealed row's ⋯ menu; in the space console's Sealed Files tab it is a plain **Force release** button. Either way it is offered only when both are true: you are a space admin of that space (Confluence space admin, a delegated user or group, or a site admin), and the site setting **Allow space admins to force-unseal** is on (Site settings → Settings → Protection; on by default). In the modal and panel it is not offered on your own seals or on trashed files (the space console button shows on every sealed row, your own included). A reason is required and recorded.

**Delete / Restore / Purge buttons not visible:**
These are disabled by default. Enable each individually in Site settings → Settings → Protection:
- **Allow Attachment Removal from Page** -- enables Delete
- **Allow Attachment Restore from Page** -- enables Restore
- **Allow Seal Cleanup from Page** -- enables Purge

**Space console not showing space admin tabs:**
The full tab set (Sealed Files, Access Control, Seal Duration, Macro, Validations, Workflow, Activity) only appears for users with space admin role. Regular users only see "My Sealed Files." Space admin status requires: space ADMINISTER permission, membership in a configured space admin group, explicit space admin delegation, or site admin status.

**Space admin access request not appearing:**
- The request may have already been approved or denied. Check the Access Control tab for the user's status.
- Denied users cannot re-request space admin access for 48 hours (this is separate from the edit-request cooldown below)

**"Declined · ask again {time}" on an edit request:**
The owner declined, and the site's cooldown is running. It is **Hours before a declined edit request can be repeated** (Site settings → Settings → Protection): default 1 hour, 0 = no wait, maximum 168. The owner (or a space admin, while **Allow space admins to force-unseal** is on) can give edit access directly at any time (**Give edit access…** under the row's ⋯ menu).

**Classification level not showing:**
- Classification is off until a site admin turns it on (Site settings → Classification tab, the switch at the top). Off hides every level; stored levels are kept.
- A space can opt out (space console → Access Control → Classification in this space). A space cannot opt in while the site switch is off.
- With it on, every page shows a level under the title and in the banner, "Unclassified" when neither the page nor its space sets one.

**Lowering a level is refused:**
Lowering or clearing a page level or a space default (including picking "use space default" when that default is lower) needs a reason of up to 300 characters. Raising needs none. Changing a page level needs edit permission on the page; a space default needs a site admin, or an admin of that space while **Allow space admins to force-unseal** is on.

**"Sign this action" keeps refusing:**
- With **Sign seal actions with an authenticator code** on (site), or a space that requires signed approvals, you must set up an authenticator once on **My work → Your approval signature**. Until then those actions are refused.
- Enter the current 6-digit code; a code can be used only once.
- After 5 wrong codes, signing is refused for 15 minutes for that account.

**REST API answers 401 or 403:**
- 401 `unauthorized`: the token is missing, malformed, revoked, or its minter is no longer a site admin. Send it as `Authorization: Bearer svt_…` or `X-Api-Key`.
- 403 `forbidden`: the token's role is too low for what was submitted (Viewer writes nothing; Editor cannot change site or space configuration). The refusal reason is in the job receipt.
- 409 `conflict`: a job with the same Idempotency-Key is still running. 429 `busy`: another job is already running for that token. See [REST-CONFIG-API.md](REST-CONFIG-API.md).

**Settings not saving:**
- Check `forge logs` for errors in the `store-policy` action
- Verify the user has the appropriate admin permissions
- Check for KVS write errors

## Performance

**Slow inline panel loading:**
The panel uses two-phase loading: it shows seal data from KVS instantly, then enriches with full metadata from the Confluence API. The second phase may take a few seconds on pages with many attachments. This is expected behavior.

**Doc ribbon showing stale data:**
The ribbon polls every 5 seconds for changes. If changes were made in another surface (page-details modal, inline panel), wait up to 5 seconds for the ribbon to update.

**Space console "Sealed Files" tab empty despite active seals:**
The space seal index is rebuilt by the hourly seal-index job; wait for the next run. Check `forge logs` for errors from `sealIndexCron`.

## Logs

Use Forge logs to diagnose issues:

```bash
# Stream live logs (useful during testing)
forge logs

# View recent logs
forge logs --recent
```

Key log prefixes to look for:
- `[NOTICE]` -- Comment notices being prepared (profile / page lookups)
- `[NOTIFY]` -- Comment posting: posted, retry, failed, suppressed
- `[SIGNATURE]` -- Signing lockouts
- `[CONFIG-API]` -- REST API requests and jobs
- `[TRIGGER]` -- Event trigger processing
- `[SEAL]` -- Seal operation details
