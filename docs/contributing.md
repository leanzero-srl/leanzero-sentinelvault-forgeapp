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
4. Open a pull request against `main`

## Code Conventions

### Capsule Pattern

Backend logic is organized into capsules under `src/server/capsules/`. Each capsule has:

- `actions.js` -- Exports an array of `[actionKey, handlerFunction]` tuples registered with the Forge Resolver
- `logic.js` -- Data operations, KVS reads/writes, and business rules (no resolver coupling)

Keep resolver-facing code in `actions.js` and reusable logic in `logic.js`. Cross-capsule imports should reference `logic.js`, not `actions.js`.

### Surface Pattern

Each UI surface under `src/ui/surfaces/` is a standalone React app with its own `index.jsx` entry point. Surfaces share utilities from `src/ui/kit/` and CSS tokens from `src/ui/tokens/`.

### CSS Tokens

Styles use CSS custom properties prefixed with `--sv-` defined in token files. Each surface has its own token stylesheet imported alongside `foundation.css` (shared base) and `controls.css` (shared form elements).

### Naming

- Capsule names are singular nouns describing the domain (`sealing`, `bulletins`, `policies`)
- Surface names match their Forge resource key (`doc-ribbon`, `inline-panel`, `overlay`)
- Infrastructure files describe their function (`mail-composer`, `artifact-fetch`, `doc-surgery`)

## Linting

```bash
npm run lint
```

ESLint is configured with React hooks rules. Fix all lint errors before submitting a pull request.

## Testing

There is no automated test suite. Test changes manually using `forge tunnel`:

**Key scenarios to verify:**

- Seal and unseal an attachment from the inline panel
- Edit a sealed attachment as a different user and confirm automatic reversion
- Verify notification delivery (toast, banner, comment, email) for each enabled channel
- Test steward console settings changes (seal duration, auto-unseal toggle, notification flags)
- Test realm console force-release as a space administrator
- Confirm the overlay search, filter, and pagination work correctly
- Upload a new attachment through the overlay upload zone

## Issue Reporting

When reporting issues, include:

- Confluence Cloud site version
- Browser and version
- Steps to reproduce
- Relevant output from `forge logs`
