# Deployment

## Prerequisites

- **Node.js 20.x** or later
- **Forge CLI** -- Install with `npm install -g @forge/cli` ([Getting started guide](https://developer.atlassian.com/platform/forge/getting-started/))
- **Atlassian developer account** with access to a Confluence Cloud site
- **Resend account** (optional, for email notifications)

## Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd sentinel-vault

# Install dependencies
npm install

# Authenticate with Forge
forge login
```

## Registering a New App

If you are deploying under your own Atlassian developer account (not using the existing app ID), register a new app:

```bash
forge register
```

This generates a new app ID. Update the `app.id` field in `manifest.yml` with your new ID.

## Building

The frontend consists of six independent React surfaces, each bundled by Webpack into `static/`:

| Surface | Entry Point | Output |
|---------|------------|--------|
| Inline Panel | `src/ui/surfaces/inline-panel/index.jsx` | `static/inline-panel/` |
| Overlay | `src/ui/surfaces/overlay/index.jsx` | `static/overlay/` |
| Doc Ribbon | `src/ui/surfaces/doc-ribbon/index.jsx` | `static/doc-ribbon/` |
| Steward Console | `src/ui/surfaces/steward-console/index.jsx` | `static/steward-console/` |
| Realm Console | `src/ui/surfaces/realm-console/index.jsx` | `static/realm-console/` |
| Panel Setup | `src/ui/surfaces/panel-setup/index.jsx` | `static/panel-setup/` |

```bash
# Production build
npm run build

# Development build with file watching
npm run dev
```

Each surface produces an `index.html`, `index.js`, and `styles.css` bundle.

**Important:** Always run `npm run build` after making any frontend or CSS changes. The `forge deploy` command uploads the contents of `static/`, so stale bundles will result in outdated UI.

## Deploying

```bash
# Deploy to the default (development) environment
forge deploy

# Deploy to a specific environment
forge deploy --environment staging
forge deploy --environment production
```

Deploying uploads the built bundles and server code to the Forge platform. No reinstall is needed after subsequent deploys to the same environment.

## Installing

```bash
# Install the app on a Confluence site
forge install --site <your-site>.atlassian.net

# Or install to a specific environment
forge install --site <your-site>.atlassian.net --environment production
```

After installation, the following modules appear in Confluence:

- **Sentinel Vault macro** -- Available in the page editor macro browser
- **Page banner** -- Appears on pages with sealed attachments
- **Global settings** -- Under Confluence administration > Apps > Sentinel Vault Admin
- **Space settings** -- Under space settings > Apps > Sentinel Vault (space admins only)
- **Overlay** -- Opens from the page banner or inline panel "Manage Attachments" button
- **Panel setup** -- Macro configuration accessible from the inline panel macro settings

## Post-Installation Verification

After installing, verify the app is working correctly:

1. **Macro**: Open a Confluence page editor, search for "Sentinel Vault" in the macro browser, and insert it. The panel should render showing page attachments.
2. **Page banner**: Navigate to any page -- the doc ribbon should appear at the top.
3. **Seal test**: Upload a test attachment, seal it from the panel, then verify the status updates to "Sealed" with a countdown timer.
4. **Reversion test**: Log in as a different user and upload a new version of the sealed file. Confirm that Sentinel Vault reverts the change and posts a comment.
5. **Steward console**: Navigate to Confluence administration > Apps > Sentinel Vault Admin. Verify settings load with defaults.
6. **Realm console**: Navigate to a space's settings > Apps > Sentinel Vault. Verify the "My Sealed Files" tab loads.

## Local Development

For local development with hot reloading:

```bash
# Terminal 1: Watch and rebuild frontend on changes
npm run dev

# Terminal 2: Start Forge tunnel (proxies requests to your local machine)
forge tunnel
```

The tunnel routes resolver calls to your local code while the UI is served from the last deployed static resources. Run `forge deploy` after frontend changes to see UI updates in the tunnel.

## Environment Configuration

### Email Notifications (Resend)

Email notifications require a [Resend](https://resend.com) API key. Set it as a Forge environment variable:

```bash
forge variables set RESEND_API_KEY <your-api-key>
```

Without this key, email notifications are silently skipped. All other notification channels (toasts, banners, comments) work independently. Emails are sent from `noreply@leanzero.atlascrafted.com`.

### Feature Flags

Notification channels are controlled by flags in the steward console (global settings UI). Defaults are defined in `src/server/shared/baseline.js`:

| Flag | Default | Controls |
|---|---|---|
| Pop-up notifications | Enabled | In-app toast messages |
| Page status banners | Enabled | Page banner alerts |
| Page comments | Enabled | Footer comments with @mentions |
| Email notifications | Enabled | All email types (master toggle) |
| Seal confirmation emails | Enabled | Confirmation and halfway reminder |
| Seal expiry reminder emails | Enabled | Auto-unseal and expiry notifications |
| Recurring reminder emails | Enabled | Periodic reminders (when expiry notifications disabled) |

See [Settings Reference](settings-reference.md) for the complete list of all configurable settings.

### Seal Duration

Default seal duration is 24 hours as configured in the steward console UI. The baseline constant in `src/server/shared/baseline.js` is 48 hours (`BASELINE_HOLD_SPAN = 2 * 24 * 60 * 60` seconds), which serves as a fallback when no admin configuration exists. Space administrators can override the global default with a custom duration in the realm console.

## Upgrading

To deploy a new version:

```bash
npm run build
forge deploy
```

No reinstall is required. Users will see the updated app on their next page load.

## Logs

```bash
# Stream live logs
forge logs

# View recent logs
forge logs --recent
```

## Troubleshooting

See [Troubleshooting](troubleshooting.md) for a comprehensive list of common issues and solutions.

**Quick checks:**

- **App not appearing after install:** Ensure you ran `npm run build` before `forge deploy`. Check that `static/` contains one subdirectory per surface (6 total).
- **Build failures:** Run `npm run lint` to check for syntax errors. Ensure Node.js version matches the `nodejs20.x` runtime in `manifest.yml`.
- **Permission errors on deploy:** Verify your Forge CLI authentication with `forge whoami`. Re-authenticate with `forge login` if needed.
- **Tunnel not connecting:** Ensure only one tunnel is running at a time. Kill any existing tunnel processes and retry.
- **Email notifications not sending:** Verify the Resend API key is set (`forge variables list`). Check that the email master toggle and individual email toggles are enabled in the steward console Alerts tab.
