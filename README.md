# Coruro

Built by **[Felipe Millán](https://fmillan.com)** · [LinkedIn](https://www.linkedin.com/in/felipemillan/)

---

A local-first desktop dashboard for your Git repositories — a Kanban board of
your local repos, enriched with GitHub data and **on-device AI summaries** powered
by Apple Intelligence. Everything runs on your machine; nothing about your code
leaves it.

## What it is

Coruro scans a folder of Git repositories and lays them out as cards on a
five-column Kanban board (Inbox · Backlog · Active · Review · Done). Each card is
an information-dashboard: language, sync state, stats, and an AI-generated summary
and tags — so you can read a project at a glance without opening it.

## Features

- **Editorial repo cards** — language-tinted header, branch sync glance
  (dirty / ahead / behind / CI), and an adaptive stat grid: stars / issues / forks
  for GitHub repos, or commits / branches / last-commit age for local-only repos.
- **On-device AI analysis** — Apple's FoundationModels LLM generates a one-line
  summary and topic tags per repo, on your machine, with no network calls and no
  API keys. Runs automatically on scan; degrades gracefully when unavailable.
- **GitHub enrichment** — stars, forks, open issues, PRs, CI status, latest
  release, topics, license, and more, cached locally and auto-refreshed.
- **Local Git status** — current branch, dirty/clean, ahead/behind upstream,
  read-only (no mutations).
- **Kanban workflow** — drag repos between columns; per-repo notes timeline
  stored alongside the repo.
- **Quick actions** — open in editor, terminal, Finder, or on GitHub.
- **Custom project names** — hover a card name and click the pencil to rename it
  locally. A reset button restores the original git folder name. Names persist
  across launches; stored in `~/.repo_dashboard_state.json` alongside other
  per-repo metadata.
- **Per-repo notes** — a Notes tab with a typed timeline (thoughts, ideas, todos,
  bugs, questions) stored in a `coruro_notes.json` file alongside each repo, so
  notes travel with the project via git.
- **AI daily notes** — a digest of recent commit activity, generated on-device by
  Apple FoundationModels. Runs manually or on a configurable timer; gated against
  hallucinations before display.
- **Ask / Code terminal** — a PTY-based tab with full Claude Code and shell
  sessions inside the app. Sessions are tracked (with metadata only — transcripts
  are never stored), grouped by repo in a sidebar, and can be pinned or revisited.
  Includes a command palette (⌘K) and a run/build button that auto-detects the
  repo type.
- **Terminal bell notifications** — opt-in audio beep and/or border flash when
  Claude Code signals task-done (OSC-safe; both toggleable in Settings).
- **Social Publisher** — an assisted-manual "Publisher" tab that turns a repo's
  read-only git context into identity-driven, intent-steered posts for LinkedIn, X,
  Instagram, TikTok, Facebook, and Reddit, with per-network formats (carousel,
  thread, story, script, single). Pick an angle, generate 1–5 variations with a
  model picker (Opus / Sonnet / Haiku), and keep a saved history of drafts. Copy a
  draft and open the platform's compose page — no auto-posting. See
  [docs/publisher.md](docs/publisher.md).
- **Claude Command Center** — a "Claude" tab that scans your local `~/.claude`
  setup and inventories your MCP servers, skills, plugins, subagents, slash
  commands, hooks, settings, and session counts, with an on-device AI health
  summary and a Setup Curator for actionable cleanup recommendations. Read-only
  and secret-free. See [docs/command-center.md](docs/command-center.md).

## Requirements

- **macOS 26 (Tahoe) or later** on **Apple Silicon** — required for the on-device
  AI feature. On Intel Macs or with Apple Intelligence disabled, the app works
  fully; only the AI summaries are skipped (a one-time banner explains why).
- **Apple Intelligence enabled** (System Settings › Apple Intelligence) for AI
  summaries.
- A GitHub Personal Access Token (optional) for GitHub enrichment. It is stored in
  the macOS Keychain, never on disk.

## Privacy

- **AI is 100% on-device.** Repo context (README excerpt, languages, recent commit
  subjects, top-level file names) is sent only to Apple's local FoundationModels —
  never to a server.
- **GitHub token** lives in the macOS Keychain (service `repo_dashboard`).
- **App state** is a single local JSON file at `~/.repo_dashboard_state.json`.
- **Command Center is read-only and secret-free** — it scans `~/.claude` for an
  inventory only, capturing env var _names_ (never values), redacting MCP endpoint
  tokens, and never reading session transcripts or memory contents.
- **Publisher generation** uses your own plan-billed Claude Code CLI (headless),
  not a separate API key; drafts and saved history stay in the local state file.

## Build from source

> Not yet code-signed or notarized, so there is no downloadable installer yet —
> build it yourself. See [Distribution status](#distribution-status) below.

**Prerequisites**

- [Node.js](https://nodejs.org/) 22+ and npm
- [Rust](https://rustup.rs/) (stable) + the Tauri 2 prerequisites
- **Xcode 26** (for the Swift AI sidecar; macOS 26 SDK with FoundationModels)

**Steps**

```bash
# 1. Install JS dependencies
npm install

# 2. Build the on-device AI sidecar (Swift) and place it for Tauri
./scripts/build-ai-sidecar.sh

# 3. Run in development
npm run tauri dev

# …or build a release bundle
npm run tauri build
```

On first launch, pick a root folder to scan and (optionally) add a GitHub token in
Settings.

## How the AI works

A small standalone Swift binary, `coruro-ai` (in [`ai-sidecar/`](ai-sidecar/)),
reads a JSON repo-context on stdin and returns `{ summary, tags }` on stdout using
`LanguageModelSession` + `@Generable` structured output. The Rust backend
(`ai_analyze`) spawns it; a serial, content-hash-cached queue in the store runs it
over each repo after a scan and writes the result to the card. The context is
capped to stay within the model's 4096-token window.

The sidecar binary is **not** committed — `scripts/build-ai-sidecar.sh` builds it.

## Tech stack

Tauri 2 (Rust) · React 19 + TypeScript · Zustand · Tailwind CSS 4 ·
Apple FoundationModels (Swift) · vitest.

## Distribution status

The app is fully functional but **not yet signed or notarized**, so distributing a
prebuilt `.dmg` would be blocked by Gatekeeper on other Macs. A signed release
(Apple Developer ID + notarization, including the sidecar) is planned. For now,
build from source.

## Roadmap

- Semantic search across repos (Apple NaturalLanguage `NLContextualEmbedding`)
- Repo relationships from AI tags + embeddings
- A statistics view aggregating AI-derived insights
- Signed, notarized release

## Claude Code toolkit

Coruro ships with a `.claude/` toolkit for anyone working on the codebase with
[Claude Code](https://claude.ai/code). It includes four subagents and two slash
commands that encode the project's architecture rules so you don't have to read
`ARCHITECTURE.md` before every change.

### Agents

| Agent              | When to use                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `coruro-architect` | Plan a non-trivial feature before writing any code — returns a numbered file sequence with type changes first and invariant checks. |
| `coruro-reviewer`  | Review a diff after implementation — returns severity-tagged findings and a `Gate-readiness: PASS / FAIL` verdict.                  |
| `coruro-explorer`  | Understand how an existing feature works — returns a file-and-line-anchored data-flow trace.                                        |
| `coruro-designer`  | Implement or polish UI in React 19 + Tailwind 4 — enforces the Neo-Brutalist design system; front-end layer only.                   |

Invoke any agent via the `--agent` flag or the `@agent` mention in a Claude Code
session, e.g. `@coruro-architect plan a new settings panel`.

### Slash commands

| Command                | What it does                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `/project:gate`        | Runs `just gate` (TypeScript + Rust + Swift + lint + tests) and summarises any failures. |
| `/project:add-feature` | Guided five-step workflow: classify layer → read contracts → implement → gate → commit.  |

## License

[MIT](LICENSE) © 2026 Felipe Millán Assler
