# Security policy

Sentinel Vault is a Confluence app built on Atlassian Forge by LeanZero SRL. If you believe you have found a
security vulnerability in it, please tell us privately so we can fix it before it is discussed in public.

## How to report

Use either of these private channels:

1. GitHub private vulnerability reporting: open the **Security** tab of this repository and choose
   **Report a vulnerability**. Only you and the maintainers can see the report.
2. Email **office@leanzero.net** with "Sentinel Vault security" in the subject.

Please do not open a public issue, pull request or discussion for a security problem.

## What to include

- what an attacker could do, and what they need first (an account on the site, a space role, an app admin role);
- the steps to reproduce it, on a Confluence site you control;
- the Sentinel Vault version you run (Confluence administration, Apps, Manage apps lists it; a Sentinel Vault
  admin also sees it in the app's site console, next to What's new);
- any proof of concept, logs or screenshots.

Test only against sites and accounts you own. Do not access, change or delete other people's content.

## What happens next

We confirm we received the report, keep you informed while we work on it, and tell you when the fix is live.
Fixes ship as a new version through the Atlassian Marketplace; Forge updates installed sites automatically for
versions that do not need new permissions. If you would like to be credited in the release notes, tell us the
name to use.

## Supported versions

Only the version currently published on the Atlassian Marketplace receives security fixes.
