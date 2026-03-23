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

The frontend consists of six independent React surfaces, each bundled by Webpack into `static/`.

```bash
# Production build
npm run build

# Development build with file watching
npm run dev
```

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
- **Space settings** -- Under space settings > Sentinel Vault (space admins only)

## Local Development

For local development with hot reloading:

```bash
# Terminal 1: Watch and rebuild frontend on changes
npm run dev

# Terminal 2: Start Forge tunnel (proxies requests to your local machine)
forge tunnel
```

The tunnel routes resolver calls to your local code while the UI is served from the last deployed static resources. Run `forge deploy` after frontend changes to see UI updates.

## Environment Configuration

### Email Notifications (Resend)

Email notifications require a [Resend](https://resend.com) API key. Set it as a Forge environment variable:

```bash
forge variables set RESEND_API_KEY <your-api-key>
```

Without this key, email notifications are silently skipped. All other notification channels (toasts, banners, comments) work independently.

### Feature Flags

Notification channels are controlled by flags in the steward console (global settings UI). Defaults are defined in `src/server/shared/baseline.js`:

| Flag | Default | Controls |
|---|---|---|
| Toast dispatches | Enabled | In-app toast messages |
| Page banners | Enabled | Page banner alerts |
| Confluence bulletins | Enabled | Footer comments with mentions |
| Email bulletins | Enabled | All email notifications (master toggle) |
| Seal expiry reminder email | Enabled | Halfway expiry reminder |
| Auto-unseal bulletin email | Enabled | Auto-unlock notification |
| Periodic reminder email | Enabled | Recurring reminders (when auto-unseal disabled) |

### Seal Duration

Default seal duration is 48 hours, defined in `src/server/shared/baseline.js` as `BASELINE_HOLD_SPAN`. This can be overridden by administrators in the steward console.

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

**App not appearing after install:**
Ensure you ran `npm run build` before `forge deploy`. Check that `static/` contains one subdirectory per surface.

**Build failures:**
Run `npm run lint` to check for syntax errors. Ensure Node.js version matches the `nodejs20.x` runtime in `manifest.yml`.

**Permission errors on deploy:**
Verify your Forge CLI authentication with `forge whoami`. Re-authenticate with `forge login` if needed.

**Tunnel not connecting:**
Ensure only one tunnel is running at a time. Kill any existing tunnel processes and retry.

**Email notifications not sending:**
Verify the Resend API key is set (`forge variables list`). Check that email bulletin flags are enabled in the steward console.
