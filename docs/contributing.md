# Contributing

## Development Setup

See [deployment.md](deployment.md) for prerequisites, installation, and local development instructions.

Quick start:

```bash
npm install
npm run dev          # Watch mode for frontend
forge tunnel         # Local development proxy (in a separate terminal)
```

## Branch Workflow

1. Create a feature branch from `main`
2. Make your changes and test locally with `forge tunnel`
3. Run `npm run lint` before committing
4. Run `npm run build` to verify the frontend compiles
5. Open a pull request against `main`

## Code Conventions

### Capsule Pattern

Backend logic is organized into capsules under `src/server/capsules/`. Each capsule has:

- `actions.js` -- Exports an array of `[actionKey, handlerFunction]` tuples registered with the Forge Resolver
- `logic.js` -- Data operations, KVS reads/writes, and business rules (no resolver coupling)

Keep resolver-facing code in `actions.js` and reusable logic in `logic.js`. Cross-capsule imports should reference `logic.js`, not `actions.js`.

Some capsules have additional files:
- `confluence-sync.js` (sealing) -- Realm index management and content property sync
- `scan-worker.js` (realms) -- Background audit queue consumer

### Surface Pattern

Each UI surface under `src/ui/surfaces/` is a standalone React app with its own `index.jsx` entry point. Surfaces share utilities from `src/ui/kit/` and CSS tokens from `src/ui/tokens/`.

All 6 surfaces:
- `inline-panel` -- Macro panel on page content
- `overlay` -- Full-featured modal dialog
- `doc-ribbon` -- Page banner notifications
- `steward-console` -- Global admin settings
- `realm-console` -- Space-level admin
- `panel-setup` -- Macro configuration

### Infrastructure Pattern

Cross-cutting services live in `src/server/infra/`. These are used by multiple capsules and follow a functional naming convention:

- `mail-composer.js` -- Orchestrates email construction and dispatch
- `mail-blueprints.js` -- HTML email templates as pure functions
- `outbound-mail.js` -- External API client (Resend)
- `artifact-fetch.js` -- Attachment URL and metadata resolution
- `doc-surgery.js` -- ADF (Atlassian Document Format) manipulation

### CSS Tokens

Styles use CSS custom properties prefixed with `--sv-` defined in token files under `src/ui/tokens/`. Each surface has its own token stylesheet imported alongside:
- `foundation.css` -- Shared base variables (colors, spacing, radius, typography) with full dark mode support via `html[data-color-mode="dark"]`
- `controls.css` -- Shared form elements (buttons, toggles, inputs, selects, modals, checkboxes)

### Naming

- Capsule names are singular nouns describing the domain (`sealing`, `bulletins`, `policies`)
- Surface names match their Forge resource key (`doc-ribbon`, `inline-panel`, `overlay`)
- Infrastructure files describe their function (`mail-composer`, `artifact-fetch`, `doc-surgery`)
- KVS keys use lowercase with hyphens (`protection-{id}`, `admin-settings-global`)

## Build System

The frontend uses Webpack 5 with a multi-entry configuration in `webpack.config.js`. Each surface is an independent entry point that outputs to its own subdirectory under `static/`.

Per-surface output:
- `index.html` -- HTML template
- `index.js` -- Bundled JavaScript (Babel-transpiled ES2023 + JSX)
- `styles.css` -- Copied from `src/ui/tokens/`

**Important:** Always run `npm run build` after any frontend or CSS changes before deploying. The `static/` directory is what gets uploaded to Forge.

## Linting

```bash
npm run lint
```

ESLint is configured with React hooks rules (`react-hooks/rules-of-hooks: "error"`). Fix all lint errors before submitting a pull request.

## Testing

There is no automated test suite. Test changes manually using `forge tunnel`:

**Core scenarios to verify:**

- Seal and unseal an attachment from the inline panel
- Seal and unseal from the overlay
- Edit a sealed attachment as a different user and confirm automatic reversion
- Trash a sealed attachment and confirm automatic restoration
- Remove a sealed inline image from page content and confirm surgical re-insertion (content protection)
- Verify notification delivery (toast, banner, comment, email) for each enabled channel
- Watch a sealed attachment as another user, release the seal, and confirm watch notification email

**Administration scenarios:**

- Test steward console settings changes across both General and Alerts tabs
- Test realm console force-release as a space steward
- Request steward access as a regular user, approve/deny as a steward
- Set a custom seal duration in a realm and confirm it overrides the global default
- Enable auto-insert macro, seal an attachment, and confirm the panel is inserted into the page
- Enable Replace Attachments Macro and confirm the native Attachments macro is replaced

**UI scenarios:**

- Confirm the overlay column picker persists across page reloads (localStorage)
- Change panel-setup configuration (columns, rows per page, cards per row) and confirm changes apply
- Upload a new attachment through the upload zone in the inline panel
- Add and remove labels on attachments
- Delete an unsealed attachment and confirm it moves to trash (when enabled)
- Restore a trashed attachment (when enabled)
- Purge an orphaned seal record (when enabled)
- Expand an image attachment card and confirm the thumbnail preview loads
- Verify dark mode rendering across all surfaces

## Issue Reporting

When reporting issues, include:

- Confluence Cloud site version
- Browser and version
- Steps to reproduce
- Relevant output from `forge logs`
- Which notification channels are enabled/disabled
- Whether the issue involves steward/admin or regular user permissions
