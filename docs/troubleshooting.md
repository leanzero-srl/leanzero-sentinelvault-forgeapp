# Troubleshooting

Common issues and solutions for Sentinel Vault.

## Installation and Deployment

**App not appearing after install:**
Ensure you ran `npm run build` before `forge deploy`. Check that the `static/` directory contains 6 subdirectories: `inline-panel`, `overlay`, `doc-ribbon`, `steward-console`, `realm-console`, `panel-setup`.

**Build failures:**
Run `npm run lint` to check for syntax errors. Ensure your Node.js version is 20.x or later to match the `nodejs20.x` runtime in `manifest.yml`.

**Permission errors on deploy:**
Verify your Forge CLI authentication with `forge whoami`. Re-authenticate with `forge login` if needed. Ensure your Atlassian account has developer access.

**Tunnel not connecting:**
Ensure only one tunnel is running at a time. Kill any existing tunnel processes (`ps aux | grep tunnel`) and retry with `forge tunnel`.

**Frontend changes not visible after deploy:**
Run `npm run build` before `forge deploy`. The deploy command uploads the contents of `static/`, so stale bundles will show outdated UI.

## Sealing and Protection

**Seal not protecting the file:**
Check if the seal has expired (status shows "Overdue"). If expiry notifications are enabled, expired seals are auto-released. Verify the seal is still active by checking the inline panel or overlay.

**Automatic reversion not happening:**
- Check `forge logs` for errors in the `artifactEventTrigger` handler
- Verify the `app-account-id` KVS key is populated (used for loop prevention). If missing, the app may be reverting its own restores
- Ensure the attachment event trigger is registered in `manifest.yml`

**Content protection not working (sealed images being removed from pages):**
- Verify the **Protect Sealed Attachments in Page Body** setting is enabled in the site settings console (General tab)
- Check `forge logs` for errors in the `pageContentTrigger` handler
- Content protection uses ADF comparison between page versions -- if the page has no prior version, protection cannot activate

**Seal shows "Overdue" but is not released:**
This means expiry notifications are **disabled** in the site settings console. Seals persist past their expiry until manually released. Enable the **Enable Seal Expiry Notifications** setting to auto-release expired seals.

**Auto-insert macro not adding the panel to pages:**
Both conditions must be met:
1. **Auto-Insert Macro on Seal** must be enabled in the site settings console (General tab)
2. The space must not have explicitly disabled auto-insert in its Macro settings

## Notifications

**Comment notifications not appearing:**
1. The app has no email service — a "notification" is a Confluence footer comment that @mentions the recipient; Confluence itself decides whether to email them (their personal notification preferences).
2. Check that the comment master toggle is on in the site console Alerts tab (it is OFF by default; in-app toast and ribbon are always on).
3. Check that the specific comment sub-type is also enabled, and that the space is not in **Quiet** mode (space console → Alerts).
4. Check `forge logs` for `[NOTICE]` log lines (prepared / posted / suppressed and why).
5. The recipient must be able to read the page; Confluence drops mentions for users without access.

**Duplicate comment notifications:**
Check if deduplication keys are being written correctly. The system uses KVS keys like `expiry-notified-{artifactId}` and `fifty-percent-reminder-sent-{artifactId}` to prevent duplicates. If these keys are being cleared prematurely, duplicates may occur.

**Toast notifications not appearing:**
- Verify **Enable Pop-up Notifications** is on in the site settings console Alerts tab
- Toast notifications rely on the Forge Bridge `showFlag` API -- they may not appear if the page refreshes immediately after the action (e.g., during reversion)
- Check browser console for errors related to `showFlag`

**Page comments not being posted:**
- Verify **Enable Page Comments** is on in the site settings console Alerts tab
- Check that the app has `write:comment:confluence` permission
- Check `forge logs` for comment posting errors

**Watch notifications not received:**
- Ensure you clicked **Watch** on the attachment (button shows "Watching" when active)
- Watch notifications are only sent when the seal is actually released (manual, expiry, or space admin override)
- Check that email notifications are enabled (master toggle + individual toggles)

## Administration

**Space admin override (force-unseal) not available:**
The **Allow space admins to force-unseal** setting must be enabled in the site settings console General tab. Only users with space admin role (space admin, delegated space admin, or group member) can see the force-unseal button.

**Delete / Restore / Purge buttons not visible:**
These are disabled by default. Enable each individually in the site settings console General tab:
- **Allow Attachment Removal from Page** -- enables Delete
- **Allow Attachment Restore from Page** -- enables Restore
- **Allow Seal Cleanup from Page** -- enables Purge

**Space console not showing space admin tabs:**
The full tab set (Sealed Files, Access Control, Seal Duration, Macro) only appears for users with space admin role. Regular users only see "My Sealed Files." Space admin status requires: space ADMINISTER permission, membership in a configured space admin group, explicit space admin delegation, or site admin status.

**Space admin access request not appearing:**
- The request may have already been approved or denied. Check the Access Control tab for the user's status.
- Denied users cannot re-request for 48 hours

**Settings not saving:**
- Check `forge logs` for errors in the `store-policy` action
- Verify the user has the appropriate admin permissions
- Check for KVS write errors

## Performance

**Slow inline panel loading:**
The panel uses two-phase loading: it shows seal data from KVS instantly, then enriches with full metadata from the Confluence API. The second phase may take a few seconds on pages with many attachments. This is expected behavior.

**Doc ribbon showing stale data:**
The ribbon polls every 5 seconds for changes. If changes were made in another surface (overlay, inline panel), wait up to 5 seconds for the ribbon to update.

**Space console "Sealed Files" tab empty despite active seals:**
The space seal index may need rebuilding. Click the space audit/scan button (if available) to trigger a background scan of the space. The scan processes pages asynchronously and may take several minutes for large spaces.

## Logs

Use Forge logs to diagnose issues:

```bash
# Stream live logs (useful during testing)
forge logs

# View recent logs
forge logs --recent
```

Key log prefixes to look for:
- `[EMAIL]` -- Email sending attempts and results
- `[TRIGGER]` -- Event trigger processing
- `[SEAL]` -- Seal operation details
