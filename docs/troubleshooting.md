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
- Verify the **Protect Sealed Attachments in Page Body** setting is enabled in the steward console (General tab)
- Check `forge logs` for errors in the `pageContentTrigger` handler
- Content protection uses ADF comparison between page versions -- if the page has no prior version, protection cannot activate

**Seal shows "Overdue" but is not released:**
This means expiry notifications are **disabled** in the steward console. Seals persist past their expiry until manually released. Enable the **Enable Seal Expiry Notifications** setting to auto-release expired seals.

**Auto-insert macro not adding the panel to pages:**
Both conditions must be met:
1. **Auto-Insert Macro on Seal** must be enabled in the steward console (General tab)
2. The realm must not have explicitly disabled auto-insert in its Macro settings

## Notifications

**Email notifications not sending:**
1. Verify the Resend API key is set: `forge variables list`
2. Check that **Enable Email Notifications** (master toggle) is on in the steward console Alerts tab
3. Check that the specific email sub-type is also enabled
4. Check `forge logs` for `[EMAIL]` prefixed log entries for send attempts and failures
5. Verify the sender domain (`leanzero.atlascrafted.com`) is verified in Resend

**Duplicate email notifications:**
Check if deduplication keys are being written correctly. The system uses KVS keys like `expiry-notified-{artifactId}` and `fifty-percent-reminder-sent-{artifactId}` to prevent duplicates. If these keys are being cleared prematurely, duplicates may occur.

**Toast notifications not appearing:**
- Verify **Enable Pop-up Notifications** is on in the steward console Alerts tab
- Toast notifications rely on the Forge Bridge `showFlag` API -- they may not appear if the page refreshes immediately after the action (e.g., during reversion)
- Check browser console for errors related to `showFlag`

**Page comments not being posted:**
- Verify **Enable Page Comments** is on in the steward console Alerts tab
- Check that the app has `write:comment:confluence` permission
- Check `forge logs` for comment posting errors

**Watch notifications not received:**
- Ensure you clicked **Watch** on the attachment (button shows "Watching" when active)
- Watch notifications are only sent when the seal is actually released (manual, expiry, or steward override)
- Check that email notifications are enabled (master toggle + individual toggles)

## Administration

**Steward override (force-unseal) not available:**
The **Allow Steward Force-Unseal** setting must be enabled in the steward console General tab. Only users with steward role (space admin, delegated steward, or guild member) can see the force-unseal button.

**Delete / Restore / Purge buttons not visible:**
These are disabled by default. Enable each individually in the steward console General tab:
- **Allow Attachment Removal from Page** -- enables Delete
- **Allow Attachment Restore from Page** -- enables Restore
- **Allow Seal Cleanup from Page** -- enables Purge

**Realm console not showing steward tabs:**
The full tab set (Realm Sealed Files, Access Control, Reservation Duration, Macro) only appears for users with steward role. Regular users only see "My Sealed Files." Steward status requires: space ADMINISTER permission, membership in a configured steward guild, explicit steward delegation, or site admin status.

**Steward access request not appearing:**
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

**Realm console "Realm Sealed Files" tab empty despite active seals:**
The realm seal index may need rebuilding. Click the realm audit/scan button (if available) to trigger a background scan of the space. The scan processes pages asynchronously and may take several minutes for large spaces.

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
