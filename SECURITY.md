# Security Policy

## Supported versions

Coruro is pre-1.0 and ships from `main`. Security fixes land on `main`; there is
no back-port branch yet. Always build from the latest `main`.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/felipemillan/Coruro/security/advisories/new)
  (preferred — Security tab → "Report a vulnerability").
- Email **hello@fmillan.com** with the subject `Coruro security`.

Include: affected version/commit, reproduction steps, impact, and any suggested
fix. A proof of concept helps but is not required.

You will get an acknowledgement within **5 business days**. Once a fix is ready,
it lands on `main` and the report is credited in the release notes unless you ask
to remain anonymous.

## Scope notes

Coruro is a **local-first desktop app**. It runs no server, makes no calls to a
backend, and sends repo context only to Apple's **on-device** FoundationModels.
The most relevant surfaces are:

- **Shell/`git` invocation** of user-supplied repo paths (command-injection).
- **GitHub Personal Access Token** handling (stored in the macOS Keychain, never
  on disk).
- **PTY-backed terminal** sessions in the Code tab.
- The **Tauri capabilities/CSP** allowlist.

Findings in these areas are especially welcome.
