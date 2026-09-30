# Deployment

## Prerequisites

- **Node.js 22.x** (the Forge runtime in `manifest.yml` is `nodejs22.x`)
- **Forge CLI** -- Install with `npm install -g @forge/cli` ([Getting started guide](https://developer.atlassian.com/platform/forge/getting-started/))
- **Atlassian developer account** with access to a Confluence Cloud site

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

The frontend consists of nine independent React surfaces, each bundled by Webpack from `src/ui/surfaces/<name>/index.jsx` into `static/<name>/`: `inline-panel`, `overlay`, `doc-ribbon`, `page-details`, `my-work`, `steward-console` (site settings), `realm-console` (space console), `panel-setup` and `section-setup`.

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
# Development environment
forge deploy
```

Production is deployed from a release tag (production 6.4.0 = git tag `v6.4.0`) with `scripts/deploy-prod.sh`. The script builds a production manifest without the dev-only `harness-test-state` webtrigger (`scripts/strip-dev-modules.mjs`), runs `forge lint -e production`, deploys, runs `forge eligibility -e production` and restores the dev manifest. Because `manifest.yml` has `licensing.enabled: true`, the script refuses to run unless you pass `--licensing-live` (confirming the paid plan is live in the Partner portal). The static `config-api` webtrigger (REST API) ships to production.

A release that adds a scope or module is a major version: every site admin must accept the update in Manage apps before the new version runs on their site.

## Installing

```bash
# Install the app on a Confluence site
forge install --site <your-site>.atlassian.net

# Or install to a specific environment
forge install --site <your-site>.atlassian.net --environment production
```

After installation, the following appear in Confluence:

- **Sentinel Vault chip** under every page title (opens the page-details modal) and **Seal attachments…** in the page ⋯ menu
- **Page banner** at the top of pages with something to show (every page when classification is on)
- **Sentinel Vault** and **Sentinel Vault Sealed Section** macros in the editor
- **Site settings** -- Confluence administration > Apps > Sentinel Vault — Site settings
- **Space console** -- the Sentinel Vault space page (Apps in the space sidebar)
- **My work** -- the Sentinel Vault — My work global page

## Post-Installation Verification

After installing, verify the app is working correctly:

1. **Page chip**: open any page; the Sentinel Vault chip shows under the title and opens the page-details modal.
2. **Seal test**: upload a test attachment, seal it from the page ⋯ menu (Seal attachments…) or the modal, and check it shows as sealed.
3. **Reversion test**: as a different user, upload a new version of the sealed file. Sentinel Vault puts the sealed version back. (Comments are off by default; the editor gets a "your change was undone" comment unless that setting is off.)
4. **Site settings**: Confluence administration > Apps > Sentinel Vault — Site settings; check the Settings tab loads with its defaults.
5. **Space console**: open the space's Sentinel Vault page; check the tabs load.

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

### Notifications

The app has no external dependencies and requires no environment variables. All notifications are posted as Confluence footer comments with `@mention` of the recipient; Confluence's own notification engine then emails the user according to their personal notification preferences. The app qualifies for the **"Runs on Atlassian"** badge — verify with `forge eligibility`.

The app has never shipped with an email integration in production; if a development environment still carries a stray `RESEND_API_KEY` variable from an early prototype, `forge variables unset RESEND_API_KEY --environment development` removes it. Nothing reads it.

### Feature flags and defaults

Notification defaults are in `DISPATCH_DEFAULTS` / `POLICY_DEFAULTS` (`src/server/shared/baseline.js`): pop-ups and the ribbon on; page comments that mention people **off** (master switch), violation comments off; the editor-revert notice on. See [Notifications](notifications.md) and [Settings Reference](settings-reference.md).

### Seal duration

The default seal duration is 48 hours (`BASELINE_HOLD_SPAN`), which is also what the site settings show for a site that never saved a value. A space can set its own duration in the space console (Seal Duration tab).

## Upgrading

To deploy a new version:

```bash
npm run build
forge deploy
```

A minor version applies to installs automatically. A major version (new scope or module) waits until a site admin accepts it.

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

- **App not appearing after install:** Ensure you ran `npm run build` before `forge deploy`. Check that `static/` contains one subdirectory per surface (9 total).
- **Build failures:** Run `npm run lint` to check for syntax errors. Ensure Node.js version matches the `nodejs22.x` runtime in `manifest.yml`.
- **Permission errors on deploy:** Verify your Forge CLI authentication with `forge whoami`. Re-authenticate with `forge login` if needed.
- **Tunnel not connecting:** Ensure only one tunnel is running at a time. Kill any existing tunnel processes and retry.
- **Comment notifications not appearing:** the app posts Confluence comments, never email. Check the comment master toggle (off by default) and the sub-type toggles in the Alerts group of the site settings Settings tab, and that the space is not in Quiet mode.
