# Changelog

All notable changes to Coruro are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Coruro is pre-1.0: it ships from `main` and has not yet had a tagged public
release. Everything below the `[Unreleased]` heading is the current state of
`main`.

## [Unreleased]

### Added

- **Custom project names** — hover a repo card name and click the pencil icon
  to set a local display name. A reset button (↺) restores the original git
  folder name. Persisted in `~/.repo_dashboard_state.json`; survives restarts
  and scans.
- **Terminal bell notifications** — the Code-tab terminal no longer beeps
  implicitly on Claude Code task-done. An OSC-safe filter strips the bare bell
  from the PTY stream and raises an opt-in notification instead: a short audio
  beep and/or a border flash, each toggleable in Settings › Terminal (audio off
  by default, visual flash on).
- **Claude Command Center** — a tab that inventories your local `~/.claude` setup
  (MCP servers, skills, plugins, subagents, commands, hooks) with an on-device AI
  health summary. Read-only and secret-free.
- **Code/Ask work center** — interactive Claude Code and shell sessions inside the
  app via a PTY, with a session sidebar, command palette, favorites, and
  drag-and-drop file insertion.
- **Daily notes** — AI-assisted day summaries with an app-activity log.
- **On-device AI repo analysis** — per-repo one-line summary and topic tags via
  Apple FoundationModels, with no network calls.

### Changed

- App-wide neo-brutalist / soft-brutalism visual restyle.

> Earlier history predates this changelog; see the git log for the full record.
