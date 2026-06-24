# AI Repo Analysis (auto on scan) — Design Spec

**Date:** 2026-06-08
**Status:** Implemented (shipped)
**Cycle:** 2 of the Apple Intelligence repo-context initiative. Builds on the
slice-1 card's `aiSummary` / `aiTags` slots.

---

## 1. Context

Slice 1 shipped an editorial repo card that already renders `Repo.aiSummary`
(description region) and `Repo.aiTags` (topic chips) when present, falling back
to GitHub data otherwise (`deriveCardData` in `src/utils/repoStats.ts`).

This cycle fills those slots: a thin end-to-end vertical that runs Apple's
on-device FoundationModels LLM over each repo's context and writes back a short
summary + topic tags. It is the first real AI consumer and proves the whole
Rust → Swift bridge chain.

### Verified platform facts (research, 2026-06-08)

- `FoundationModels` is usable from a plain `swiftc`/SPM command-line binary —
  no app bundle, no entitlement, no Info.plist key. Deployment target macOS 26.0.
- **Apple Silicon only.** Intel → `.unavailable(.deviceNotEligible)`.
- Apple Intelligence must be user-enabled in System Settings, or
  `.unavailable(.appleIntelligenceNotEnabled)`. Cannot be enabled
  programmatically. Assets may still be downloading → `.unavailable(.modelNotReady)`.
- `SystemLanguageModel.default.availability` → `.available` / `.unavailable(reason)`.
- `LanguageModelSession(instructions:)`; `respond(to:generating:)` is
  `async throws`; `@Generable` + `@Guide` give constrained, schema-valid output.
- **4096-token session window** (input + schema + output combined); overflow
  throws `GenerationError.exceededContextWindowSize`. Context must stay small.
- Tauri v2 sidecar: `bundle.externalBin`, binary named with target-triple suffix
  `-aarch64-apple-darwin`, spawned via `app.shell().sidecar()`, stdin/stdout.
- Local dev (unsandboxed Tauri) needs no signing; distribution requires
  Developer-ID sign + notarize of the whole bundle incl. the sidecar.

Citations live in the cycle's research notes (FoundationModels availability enum,
WWDC25 sessions 286/301, TN3193 context window, NLContextualEmbedding docs,
Tauri sidecar docs).

## 2. Goals

- One coherent vertical: repo context → on-device LLM → `{summary, tags}` →
  persisted → rendered in the existing card slots.
- Auto-run on scan for repos missing or stale AI data; serial, throttled,
  low-priority; never blocks the UI.
- Cache by content hash so a re-scan does not re-spend compute.
- Degrade gracefully when Apple Intelligence is unavailable — empty slots, one
  explanatory banner, no retry storm.

### Non-goals (this cycle)

- No semantic search / embeddings (next cycle; NLContextualEmbedding confirmed
  feasible but out of scope here).
- No relationships graph, no statistics tab.
- No streaming UI (use the non-streaming `respond` path; summaries are short).
- No manual per-card trigger as the primary path (a force-refresh affordance is
  a small add, but auto-on-scan is the contract).

## 3. Architecture & data flow

```
scan completes
  → store.enrichAi(): for each repo where aiCache miss or inputHash changed
      → buildAiContext(repo)              [src/utils/aiContext.ts, bounded]
      → invoke('ai_analyze', { context })  [Rust command]
          → app.shell().sidecar("coruro-ai")    spawn
          → write context JSON to stdin
          → Swift: check availability → LanguageModelSession.respond(generating:)
          → read {ok, summary, tags} | {ok:false, error, reason} from stdout
      → store merges into aiCache[path] + Repo.aiSummary/aiTags → save() → card renders
```

Queue is **serial** (concurrency 1): the on-device model handles one request at a
time and first-run incurs model load. New scans cancel an in-flight queue.

## 4. Swift sidecar `coruro-ai`

A standalone SPM executable (`Package.swift`, `platforms: [.macOS("26.0")]`).
Reads one JSON request from stdin, writes one JSON response to stdout, exits.

**Request (stdin):**

```json
{
  "repoName": "Coruro",
  "description": "Git dashboard, Tauri + React",
  "languages": ["Rust", "TypeScript"],
  "recentCommits": ["feat(card): ...", "fix(store): ...", "..."],
  "topEntries": ["src", "src-tauri", "package.json", "README.md"],
  "readme": "first ~1200 chars of README or empty"
}
```

**Response (stdout) — success:**

```json
{
  "ok": true,
  "summary": "…≤ 30 words…",
  "tags": ["rust", "tauri", "desktop"],
  "model": "apple-on-device"
}
```

**Response — unavailable / error:**

```json
{ "ok": false, "error": "unavailable", "reason": "appleIntelligenceNotEnabled" }
```

`error` ∈ `unavailable | contextOverflow | generation | badInput`. For
`unavailable`, `reason` ∈ `deviceNotEligible | appleIntelligenceNotEnabled | modelNotReady`.

**Generated output type:**

```swift
@Generable
struct RepoAnalysis {
    @Guide(description: "One-sentence summary of what this repository is, ≤ 30 words")
    var summary: String
    @Guide(description: "3–6 lowercase topic tags", .maximumCount(6))
    var tags: [String]
}
```

**Core flow:**

```swift
import FoundationModels
import Foundation

let model = SystemLanguageModel.default
switch model.availability {
case .available: break
case .unavailable(.deviceNotEligible):        emit(unavailable: "deviceNotEligible"); exit(0)
case .unavailable(.appleIntelligenceNotEnabled): emit(unavailable: "appleIntelligenceNotEnabled"); exit(0)
case .unavailable(.modelNotReady):            emit(unavailable: "modelNotReady"); exit(0)
case .unavailable:                            emit(unavailable: "modelNotReady"); exit(0)
}

let session = LanguageModelSession(
    instructions: "You describe software repositories. Be concise and factual. Never invent features not evidenced by the input."
)
do {
    let prompt = buildPrompt(from: request)   // compact; see §6 budget
    let result = try await session.respond(to: prompt, generating: RepoAnalysis.self)
    emit(ok: result.content.summary, tags: result.content.tags)
} catch LanguageModelSession.GenerationError.exceededContextWindowSize {
    emit(error: "contextOverflow")
} catch {
    emit(error: "generation", reason: String(describing: error))
}
```

**`--selftest` mode:** when invoked with `--selftest`, skip the model and echo a
fixed valid success JSON. Lets the Rust/JS contract and bundling be tested on any
machine (incl. CI without Apple Intelligence).

**Build:** `swift build -c release` (arm64). Copy the product to
`src-tauri/binaries/coruro-ai-aarch64-apple-darwin`. A `scripts/build-ai-sidecar.sh`
wraps build + rename. arm64-only is acceptable (Apple Intelligence is
Apple-Silicon-only anyway).

## 5. Rust commands

**`ai_analyze`** (new, `src-tauri/src/commands.rs`, needs `AppHandle` + shell):

- Input: the context struct (serde). Spawn `coruro-ai` sidecar, write JSON to
  stdin, collect stdout, parse, return a typed result enum to JS.
- 30s timeout → `{ ok:false, error:"timeout" }`-equivalent. Sidecar-missing →
  `error:"sidecar_missing"`.
- Registered in `lib.rs` handler.

**`git_recent_commits`** (new): `git -C <path> log -n 20 --format=%s` → `Vec<String>`,
empty on failure. Mirrors `git_local_stats` style. Registered in handler.

(README + top-level entries come from the existing `@tauri-apps/plugin-fs`
`readDir` / `readTextFile` on the JS side — no new command needed.)

## 6. Context builder `src/utils/aiContext.ts`

Pure assembly + hard caps to stay well under the 4096-token window (budget for
instructions + schema + output). Conservative char budget (~3.5 chars/token):

- `repoName`: as-is.
- `description`: `gh.description` if present, else ''.
- `languages`: `gh.language` + any cheap local signal; ≤ 5 entries.
- `recentCommits`: from `git_recent_commits`, ≤ 15 subjects, each ≤ 100 chars.
- `topEntries`: top-level dir/file names via `readDir`, ≤ 25 names.
- `readme`: first ≤ 1200 chars of `README.md` (via `readTextFile`), else ''.
- **Total request payload capped ≤ ~6000 chars** (≈ 1700 tokens), leaving ample
  room for schema + response. `buildAiContext` truncates to hit the cap.
- `inputHash`: stable hash (e.g. FNV/`cyrb53`) of the assembled payload →
  drives cache freshness.

## 7. Store: cache, queue, hydration

**Persistence** — extend `AppState`:

```ts
export interface AiCacheEntry {
  summary: string;
  tags: string[];
  model: string;
  analyzedAt: string; // ISO
  inputHash: string;
}
export type AiCache = Record<string, AiCacheEntry>; // keyed by repo path
// + AppState.aiCache: AiCache
// + AppState.aiUnavailableReason?: string | null  (one-time banner state)
```

**Hydration:** on scan, copy `aiCache[path]` → `Repo.aiSummary` / `aiTags`
(mirrors `ghCache` → `Repo.gh`).

**Queue actions:**

- `enrichAi()`: serial worker over repos whose `aiCache` is missing or whose
  freshly built `inputHash` differs. Low priority (runs after `enrichGit` /
  GitHub enrichment). Cancels on a new scan.
- `enrichAiOne(path)`: force re-analyze one repo (used by the optional card
  force button).
- On `error:"unavailable"`: set `aiUnavailableReason`, **stop the queue** (no
  point continuing this session), don't mark repos as failed permanently.

## 8. Availability & errors

- `unavailable` → one-time top banner: "Apple Intelligence is off or unavailable
  — AI summaries disabled. Enable it in System Settings › Apple Intelligence."
  Dismissible; respects the existing debug-banner pattern. Slots stay empty.
- `contextOverflow` / `generation` / `badInput` → skip that repo, leave slots
  empty, console log; continue queue.
- `timeout` / `sidecar_missing` → skip, log; continue.
- Never block scan, GitHub enrichment, or UI on AI.

## 9. Card indicator

While a repo is queued/analyzing, show a faint "✨ analyzing…" line in the
description region (driven by a transient `analyzingPaths` set in the view/board
store, not persisted). On completion the real summary replaces it. Optional small
✨ button in the action row calls `enrichAiOne(path)` to force a refresh.

## 10. Build / distribution

- Local dev: `scripts/build-ai-sidecar.sh` builds + places the arm64 binary;
  `tauri.conf.json` `bundle.externalBin` references `binaries/coruro-ai`.
  Capabilities: allow the shell `sidecar` permission for `coruro-ai`.
- Distribution (later): Developer-ID sign + notarize the bundle incl. sidecar.
  Out of scope for this cycle's acceptance (dev-run is the bar).

## 11. Testing

- **Swift sidecar:** a shell test invoking `coruro-ai --selftest` asserts the
  success JSON contract. (Model output itself is non-deterministic and
  device-gated — not unit-tested.)
- **Rust `ai_analyze`:** test request/response serde + error mapping using the
  `--selftest` sidecar (and a forced-missing path for `sidecar_missing`).
  `git_recent_commits` test against the repo itself (≥ 1 subject).
- **`aiContext.ts`:** pure tests — capping (oversized README/commits truncate
  under budget), assembly, `inputHash` stability + change-on-edit.
- **Store:** queue selects only missing/stale repos; `unavailable` stops the
  queue and sets the banner reason (mock `invoke`).
- **Card:** `aiSummary`/`aiTags` rendering already covered in slice 1; add an
  `analyzing…` indicator render test.

## 12. Execution strategy — ultracode workflow

Model tier per task complexity.

**Phase 1 — Swift sidecar** (novel, highest risk):

- `Package.swift`, `Sources/coruro-ai/main.swift` (availability, session,
  `@Generable`, `--selftest`), `scripts/build-ai-sidecar.sh`, build the binary —
  agent: backend-developer — model: **opus** (novel API, no codebase precedent).

**Phase 2 — Rust + context** (parallel, after P1 contract is fixed):

- `ai_analyze` + `git_recent_commits` commands + handler registration +
  `tauri.conf.json` externalBin + capability — backend-developer — **sonnet**.
- `src/utils/aiContext.ts` + tests (pure) — typescript-pro — **sonnet**.
- `src/types.ts` AiCache types — general — **haiku**.

**Phase 3 — Store wiring** (barrier — needs types + command + context):

- `aiCache` persistence, hydration, serial `enrichAi`/`enrichAiOne`, queue
  cancel, unavailable→banner — typescript-pro — **opus** (stateful, async,
  cancellation).

**Phase 4 — UI** (after store):

- `analyzing…` indicator + optional ✨ force button + unavailable banner —
  ui-designer — **sonnet**.

**Phase 5 — Verify** (adversarial):

- `npm test` + `npm run build` + `cargo build` + `coruro-ai --selftest`
  contract — general — **sonnet**.
- Code review (queue cancellation correctness, token-budget caps, error paths) —
  code-reviewer — **opus**.

Swift sidecar phase blocks the rest (it defines the JSON contract). Agents write
files only; the orchestrator commits per phase (avoids concurrent-git races).

## 13. Open items (deferred, not blocking)

- Long-lived sidecar process (avoid per-call spawn) — only if latency hurts.
- Manual per-card trigger as a first-class feature.
- Signing/notarization for distribution.
- Embeddings / semantic search (next cycle) — reuse `aiContext` + NLContextualEmbedding.
- `tokenCount(for:)` (macOS 26.4+) for exact budgeting instead of the char heuristic.
