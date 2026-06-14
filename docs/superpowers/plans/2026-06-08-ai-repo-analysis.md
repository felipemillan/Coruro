# AI Repo Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-analyze each repo on scan with Apple's on-device FoundationModels LLM via a Swift sidecar, writing a short summary + topic tags into the slice-1 card slots.

**Architecture:** A standalone Swift CLI sidecar (`coruro-ai`) reads a JSON repo-context request on stdin, runs guided generation, and writes `{summary, tags}` JSON on stdout. A Rust `ai_analyze` command spawns it. A serial, content-hash-cached store queue (`enrichAi`) feeds repos through it after scan and merges results into `Repo.aiSummary`/`aiTags`, which the card already renders. Unavailable Apple Intelligence degrades gracefully.

**Tech Stack:** Swift 6 / FoundationModels (macOS 26, Apple Silicon), Tauri 2 sidecar (`externalBin`), Rust, React 19 + TypeScript, Zustand, vitest.

**Base branch:** `feat/ai-repo-analysis` (stacked on `feat/editorial-repo-card`; needs the slice-1 `aiSummary`/`aiTags` slots).

---

## File Structure

| File                                                | Responsibility                                                      | Action    |
| --------------------------------------------------- | ------------------------------------------------------------------- | --------- |
| `ai-sidecar/Package.swift`                          | SPM manifest, macOS 26 platform                                     | Create    |
| `ai-sidecar/Sources/coruro-ai/main.swift`           | availability + session + `@Generable` + `--selftest`                | Create    |
| `scripts/build-ai-sidecar.sh`                       | build + place arm64 binary                                          | Create    |
| `src-tauri/binaries/coruro-ai-aarch64-apple-darwin` | built sidecar (artifact)                                            | Generated |
| `src-tauri/tauri.conf.json`                         | `bundle.externalBin`                                                | Modify    |
| `src-tauri/capabilities/default.json`               | shell sidecar permission                                            | Modify    |
| `src-tauri/src/commands.rs`                         | `git_recent_commits`, `ai_analyze`                                  | Modify    |
| `src-tauri/src/lib.rs`                              | register commands                                                   | Modify    |
| `src/types.ts`                                      | `AiContext`, `AiCacheEntry`, `AiCache`, `AiResult`, AppState fields | Modify    |
| `src/utils/aiContext.ts`                            | assemble bounded context + `inputHash` (pure core)                  | Create    |
| `src/utils/aiContext.test.ts`                       | tests                                                               | Create    |
| `src/store/useBoardStore.ts`                        | aiCache persist/hydrate + serial `enrichAi`/`enrichAiOne`           | Modify    |
| `src/components/AiBanner.tsx`                       | one-time "Apple Intelligence unavailable" banner                    | Create    |
| `src/components/RepoCard.tsx`                       | "✨ analyzing…" indicator + force button                            | Modify    |

---

## Task 1: Swift sidecar `coruro-ai`

**Files:**

- Create: `ai-sidecar/Package.swift`
- Create: `ai-sidecar/Sources/coruro-ai/main.swift`
- Create: `scripts/build-ai-sidecar.sh`

- [ ] **Step 1: Write `Package.swift`**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "coruro-ai",
    platforms: [.macOS("26.0")],
    targets: [
        .executableTarget(name: "coruro-ai", path: "Sources/coruro-ai")
    ]
)
```

- [ ] **Step 2: Write `Sources/coruro-ai/main.swift`**

```swift
import Foundation
import FoundationModels

// ── JSON contracts ──
struct AiRequest: Decodable {
    var repoName: String
    var description: String?
    var languages: [String]
    var recentCommits: [String]
    var topEntries: [String]
    var readme: String?
}

struct AiResponse: Encodable {
    var ok: Bool
    var summary: String?
    var tags: [String]?
    var model: String?
    var error: String?
    var reason: String?
}

@Generable
struct RepoAnalysis {
    @Guide(description: "One-sentence summary of what this repository is, at most 30 words")
    var summary: String
    @Guide(description: "Between 3 and 6 short lowercase topic tags", .maximumCount(6))
    var tags: [String]
}

func emit(_ r: AiResponse) {
    let data = (try? JSONEncoder().encode(r)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
}

func buildPrompt(_ req: AiRequest) -> String {
    var lines: [String] = []
    lines.append("Repository: \(req.repoName)")
    if let d = req.description, !d.isEmpty { lines.append("Description: \(d)") }
    if !req.languages.isEmpty { lines.append("Languages: \(req.languages.joined(separator: ", "))") }
    if !req.topEntries.isEmpty { lines.append("Top-level entries: \(req.topEntries.joined(separator: ", "))") }
    if !req.recentCommits.isEmpty {
        lines.append("Recent commits:")
        for c in req.recentCommits { lines.append("- \(c)") }
    }
    if let r = req.readme, !r.isEmpty { lines.append("README excerpt:\n\(r)") }
    lines.append("\nSummarize this repository and produce topic tags.")
    return lines.joined(separator: "\n")
}

// ── --selftest: device-independent contract check ──
if CommandLine.arguments.contains("--selftest") {
    emit(AiResponse(ok: true, summary: "Selftest summary.", tags: ["selftest", "ok"],
                    model: "selftest", error: nil, reason: nil))
    exit(0)
}

// ── Read request ──
let input = FileHandle.standardInput.readDataToEndOfFile()
guard let req = try? JSONDecoder().decode(AiRequest.self, from: input) else {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "badInput", reason: "could not decode request"))
    exit(0)
}

// ── Availability ──
switch SystemLanguageModel.default.availability {
case .available:
    break
case .unavailable(.deviceNotEligible):
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "deviceNotEligible")); exit(0)
case .unavailable(.appleIntelligenceNotEnabled):
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "appleIntelligenceNotEnabled")); exit(0)
case .unavailable(.modelNotReady):
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "modelNotReady")); exit(0)
case .unavailable:
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "modelNotReady")); exit(0)
}

// ── Generate ──
let session = LanguageModelSession(
    instructions: "You describe software repositories concisely and factually. Never invent features not evidenced by the input."
)
do {
    let result = try await session.respond(to: buildPrompt(req), generating: RepoAnalysis.self)
    emit(AiResponse(ok: true, summary: result.content.summary, tags: result.content.tags,
                    model: "apple-on-device", error: nil, reason: nil))
} catch let e as LanguageModelSession.GenerationError where {
    if case .exceededContextWindowSize = e { return true } else { return false }
}() {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "contextOverflow", reason: nil))
} catch {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "generation", reason: String(describing: error)))
}
```

Note: if the `catch where` pattern above does not compile on the toolchain, replace the two `catch` clauses with a single `catch { ... }` that inspects the error: `if case LanguageModelSession.GenerationError.exceededContextWindowSize = error { emit(... "contextOverflow" ...) } else { emit(... "generation" ...) }`. Either form is acceptable; the requirement is that an overflow maps to `error:"contextOverflow"` and all other throws map to `error:"generation"`.

- [ ] **Step 3: Write `scripts/build-ai-sidecar.sh`**

```bash
#!/usr/bin/env bash
# Build the Apple Intelligence sidecar and place it where Tauri expects it.
set -euo pipefail
cd "$(dirname "$0")/../ai-sidecar"
swift build -c release
BIN=".build/release/coruro-ai"
DEST="../src-tauri/binaries/coruro-ai-aarch64-apple-darwin"
mkdir -p "../src-tauri/binaries"
cp "$BIN" "$DEST"
echo "Placed sidecar at $DEST"
```

- [ ] **Step 4: Build the sidecar and verify the selftest contract**

Run:

```bash
chmod +x scripts/build-ai-sidecar.sh
./scripts/build-ai-sidecar.sh
./src-tauri/binaries/coruro-ai-aarch64-apple-darwin --selftest
```

Expected: build succeeds; selftest prints `{"ok":true,"summary":"Selftest summary.","tags":["selftest","ok"],"model":"selftest"}` (key order may vary).

If `swift build` fails because the Swift toolchain predates FoundationModels, stop and report — this environment cannot build the sidecar; the rest of the plan (Rust/TS) can still proceed against the `--selftest` contract.

- [ ] **Step 5: Commit**

```bash
git add ai-sidecar/Package.swift ai-sidecar/Sources/coruro-ai/main.swift scripts/build-ai-sidecar.sh src-tauri/binaries/coruro-ai-aarch64-apple-darwin
git commit -m "feat(ai): Swift FoundationModels sidecar (coruro-ai) + build script"
```

---

## Task 2: Bundle + capability for the sidecar

**Files:**

- Modify: `src-tauri/tauri.conf.json` (`bundle` object)
- Modify: `src-tauri/capabilities/default.json` (shell allow list)

- [ ] **Step 1: Add `externalBin` to `tauri.conf.json`**

In the `"bundle"` object, add the `externalBin` key (keep existing keys):

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/coruro-ai"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
```

- [ ] **Step 2: Allow spawning the sidecar in `capabilities/default.json`**

Inside the `"shell:allow-execute"` permission's `"allow"` array, append this entry (after the existing `"open"` entry):

```json
{
  "name": "binaries/coruro-ai",
  "sidecar": true,
  "args": ["--selftest"]
}
```

Note: `args` here is the static-validator allow-list for argument shapes; the live call passes no args (it pipes JSON via stdin), and `--selftest` is permitted for the contract test. If Tauri's schema rejects an empty live arg set against this validator, change `"args"` to `true` to allow any args for this sidecar.

- [ ] **Step 3: Verify config parses**

Run: `cd src-tauri && cargo build`
Expected: builds (config is validated at build time); no schema error.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(ai): register coruro-ai sidecar (externalBin + shell capability)"
```

---

## Task 3: Rust `git_recent_commits` command

**Files:**

- Modify: `src-tauri/src/commands.rs` (append command + test)
- Modify: `src-tauri/src/lib.rs` (register)

- [ ] **Step 1: Append the command to `commands.rs`**

```rust
/// Last N commit subject lines (`git -C <path> log -n <n> --format=%s`).
/// Returns an empty vec on any failure so a single odd repo never breaks scan.
#[tauri::command]
pub fn git_recent_commits(path: String, count: u32) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .args(["-C", &path, "log", "-n", &count.to_string(), "--format=%s"])
        .output();
    let subjects = out
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.to_string())
                .filter(|l| !l.trim().is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    Ok(subjects)
}

#[cfg(test)]
mod recent_commits_tests {
    use super::*;
    #[test]
    fn lists_subjects_for_this_repo() {
        let subjects = git_recent_commits(env!("CARGO_MANIFEST_DIR").to_string(), 5).unwrap();
        assert!(!subjects.is_empty(), "expected at least one commit subject");
    }
}
```

- [ ] **Step 2: Run the test**

Run: `cd src-tauri && cargo test recent_commits_tests`
Expected: PASS.

- [ ] **Step 3: Register in `lib.rs`**

Add `commands::git_recent_commits` to the `generate_handler!` list (after `commands::git_local_stats`).

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(git): add git_recent_commits command"
```

---

## Task 4: Rust `ai_analyze` command

**Files:**

- Modify: `src-tauri/src/commands.rs` (append command + imports)
- Modify: `src-tauri/src/lib.rs` (register)

- [ ] **Step 1: Append the command to `commands.rs`**

Add near the top of the file (with other `use`s):

```rust
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::time::Duration;
```

Append the command:

```rust
/// Request shape mirrors src/types.ts AiContext (serde camelCase).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContext {
    repo_name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default)]
    recent_commits: Vec<String>,
    #[serde(default)]
    top_entries: Vec<String>,
    #[serde(default)]
    readme: Option<String>,
}

/// Spawn the coruro-ai sidecar, pipe the context JSON to stdin, and return
/// the sidecar's JSON line verbatim (a string the JS layer parses into AiResult).
/// On spawn/timeout failure returns a synthetic error JSON so the caller always
/// gets a well-formed AiResult.
#[tauri::command]
pub async fn ai_analyze(app: tauri::AppHandle, context: AiContext) -> Result<String, String> {
    let payload = serde_json::to_vec(&serde_json::json!({
        "repoName": context.repo_name,
        "description": context.description,
        "languages": context.languages,
        "recentCommits": context.recent_commits,
        "topEntries": context.top_entries,
        "readme": context.readme,
    })).map_err(|e| e.to_string())?;

    let sidecar = match app.shell().sidecar("coruro-ai") {
        Ok(c) => c,
        Err(_) => return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string()),
    };
    let (mut rx, mut child) = match sidecar.spawn() {
        Ok(v) => v,
        Err(_) => return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string()),
    };
    if child.write(&payload).is_err() {
        return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string());
    }
    let _ = child.write(b"\n");

    let mut acc = String::new();
    let collect = async {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(bytes) = event {
                acc.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        acc
    };
    match tokio::time::timeout(Duration::from_secs(30), collect).await {
        Ok(out) if !out.trim().is_empty() => Ok(out.trim().to_string()),
        Ok(_) => Ok(r#"{"ok":false,"error":"generation","reason":"empty output"}"#.to_string()),
        Err(_) => Ok(r#"{"ok":false,"error":"timeout"}"#.to_string()),
    }
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add `commands::ai_analyze` to the `generate_handler!` list (after `commands::git_recent_commits`).

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: clean. If `tokio` is not already an explicit dependency, add `tokio = { version = "1", features = ["time"] }` to `src-tauri/Cargo.toml` `[dependencies]` (Tauri pulls tokio transitively; an explicit entry is only needed if the import fails to resolve).

- [ ] **Step 4: Verify end-to-end with the selftest sidecar (manual)**

Run: `npm run tauri dev`, then in the app devtools console:
`await window.__TAURI__.core.invoke('ai_analyze', { context: { repoName: 'x', languages: [], recentCommits: [], topEntries: [] } })`
Expected: a JSON string. On an Apple-Intelligence-enabled machine: `{"ok":true,...}`; otherwise `{"ok":false,"error":"unavailable",...}`. Either is a pass (the bridge works).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(ai): add ai_analyze command spawning the sidecar"
```

---

## Task 5: TypeScript types

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Add the AI types**

After the `GhCache` type block in `src/types.ts`, add:

```ts
/** Context payload sent to the AI sidecar (camelCase matches Rust AiContext). */
export interface AiContext {
  repoName: string;
  description: string | null;
  languages: string[];
  recentCommits: string[];
  topEntries: string[];
  readme: string | null;
}

/** Parsed sidecar result. `ok:true` carries summary+tags; else error/reason. */
export interface AiResult {
  ok: boolean;
  summary?: string;
  tags?: string[];
  model?: string;
  error?:
    | 'unavailable'
    | 'contextOverflow'
    | 'generation'
    | 'badInput'
    | 'timeout'
    | 'sidecar_missing';
  reason?: string;
}

/** One persisted AI analysis, keyed by repo path in AppState.aiCache. */
export interface AiCacheEntry {
  summary: string;
  tags: string[];
  model: string;
  analyzedAt: string; // ISO 8601
  inputHash: string; // hash of the assembled context — drives freshness
}

/** Persisted AI cache, keyed by repo absolute path. */
export type AiCache = Record<string, AiCacheEntry>;
```

- [ ] **Step 2: Add fields to `AppState`**

In `export interface AppState`, after `ghCache: GhCache;`, add:

```ts
/** Cached AI analysis per repo; hydrated into Repo.aiSummary/aiTags on scan. */
aiCache: AiCache;
```

- [ ] **Step 3: Initialise in `createEmptyAppState`**

In the object returned by `createEmptyAppState()`, after `ghCache: {},`, add:

```ts
    aiCache: {},
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (consumers updated in later tasks; this task only adds types + a default).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add AiContext/AiResult/AiCache types + AppState.aiCache"
```

---

## Task 6: `aiContext` builder (pure core + tests)

**Files:**

- Create: `src/utils/aiContext.ts`
- Test: `src/utils/aiContext.test.ts`

- [ ] **Step 1: Write the failing test**

`src/utils/aiContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assembleContext, inputHash, MAX_PAYLOAD_CHARS } from './aiContext';

describe('assembleContext', () => {
  it('caps commits, entries, readme, and total size', () => {
    const ctx = assembleContext({
      repoName: 'Coruro',
      description: 'Git dashboard',
      languages: ['Rust', 'TypeScript', 'CSS', 'HTML', 'Shell', 'Go'],
      recentCommits: Array.from({ length: 40 }, (_, i) => `commit subject number ${i}`),
      topEntries: Array.from({ length: 60 }, (_, i) => `entry${i}`),
      readme: 'x'.repeat(5000),
    });
    expect(ctx.languages.length).toBeLessThanOrEqual(5);
    expect(ctx.recentCommits.length).toBeLessThanOrEqual(15);
    expect(ctx.topEntries.length).toBeLessThanOrEqual(25);
    expect((ctx.readme ?? '').length).toBeLessThanOrEqual(1200);
    const total = JSON.stringify(ctx).length;
    expect(total).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
  });

  it('truncates overly long commit subjects to 100 chars', () => {
    const ctx = assembleContext({
      repoName: 'r',
      description: null,
      languages: [],
      recentCommits: ['y'.repeat(200)],
      topEntries: [],
      readme: null,
    });
    expect(ctx.recentCommits[0].length).toBeLessThanOrEqual(100);
  });
});

describe('inputHash', () => {
  it('is stable for identical input and changes when input changes', () => {
    const a = assembleContext({
      repoName: 'r',
      description: 'd',
      languages: ['Rust'],
      recentCommits: ['c'],
      topEntries: ['src'],
      readme: null,
    });
    const b = assembleContext({
      repoName: 'r',
      description: 'd',
      languages: ['Rust'],
      recentCommits: ['c'],
      topEntries: ['src'],
      readme: null,
    });
    const c = assembleContext({
      repoName: 'r',
      description: 'd2',
      languages: ['Rust'],
      recentCommits: ['c'],
      topEntries: ['src'],
      readme: null,
    });
    expect(inputHash(a)).toBe(inputHash(b));
    expect(inputHash(a)).not.toBe(inputHash(c));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/aiContext.test.ts`
Expected: FAIL — cannot find module `./aiContext`.

- [ ] **Step 3: Implement `aiContext.ts`**

```ts
// aiContext.ts — assemble a bounded AI context payload for one repo.
// Split into a PURE core (assembleContext, inputHash) that is unit-tested, and
// an async gatherer (buildAiContext) that does the IO (git/fs) and delegates to
// the pure core. The 4096-token model window forces hard caps.

import { invoke } from '@tauri-apps/api/core';
import { readDir, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { AiContext, Repo } from '../types';

/** Conservative payload ceiling (~3.5 chars/token → well under 4096 tokens). */
export const MAX_PAYLOAD_CHARS = 6000;

interface RawParts {
  repoName: string;
  description: string | null;
  languages: string[];
  recentCommits: string[];
  topEntries: string[];
  readme: string | null;
}

/** PURE: cap and normalise raw parts into a bounded AiContext. */
export function assembleContext(parts: RawParts): AiContext {
  const languages = parts.languages.slice(0, 5);
  const recentCommits = parts.recentCommits.slice(0, 15).map((c) => c.slice(0, 100));
  const topEntries = parts.topEntries.slice(0, 25);
  let readme = parts.readme ? parts.readme.slice(0, 1200) : null;

  let ctx: AiContext = {
    repoName: parts.repoName,
    description: parts.description,
    languages,
    recentCommits,
    topEntries,
    readme,
  };

  // Final guard: if still over budget, drop the readme, then trim commits.
  if (JSON.stringify(ctx).length > MAX_PAYLOAD_CHARS) {
    readme = null;
    ctx = { ...ctx, readme };
  }
  while (JSON.stringify(ctx).length > MAX_PAYLOAD_CHARS && ctx.recentCommits.length > 0) {
    ctx = { ...ctx, recentCommits: ctx.recentCommits.slice(0, ctx.recentCommits.length - 1) };
  }
  return ctx;
}

/** PURE: stable 53-bit hash (cyrb53) of the assembled context. */
export function inputHash(ctx: AiContext): string {
  const str = JSON.stringify(ctx);
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Async: gather raw repo signals (git + fs), then assemble. */
export async function buildAiContext(repo: Repo): Promise<AiContext> {
  let recentCommits: string[] = [];
  try {
    recentCommits = await invoke<string[]>('git_recent_commits', { path: repo.path, count: 20 });
  } catch {
    recentCommits = [];
  }

  let topEntries: string[] = [];
  try {
    const entries = await readDir(repo.path);
    topEntries = entries.map((e) => e.name).filter((n) => n !== '.git');
  } catch {
    topEntries = [];
  }

  let readme: string | null = null;
  try {
    const readmePath = await join(repo.path, 'README.md');
    if (await exists(readmePath)) readme = await readTextFile(readmePath);
  } catch {
    readme = null;
  }

  const languages = repo.gh?.language ? [repo.gh.language] : [];

  return assembleContext({
    repoName: repo.name,
    description: repo.gh?.description ?? null,
    languages,
    recentCommits,
    topEntries,
    readme,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/aiContext.test.ts`
Expected: PASS (all `assembleContext` + `inputHash` tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiContext.ts src/utils/aiContext.test.ts
git commit -m "feat(ai): bounded aiContext builder + content hash"
```

---

## Task 7: Store — persist, hydrate, and the serial AI queue

**Files:**

- Modify: `src/store/useBoardStore.ts`

This task mirrors the existing `ghCache` persistence pattern. The store already:
serialises `{ settings, board, repoMetadata, ghCache }`, hydrates `ghCache` in
`loadState`, includes `ghCache` in `save()`, and hydrates `Repo.gh` from
`ghCache` in `scanAndDistribute`. Add `aiCache` alongside each, plus a serial
queue.

- [ ] **Step 1: Persist `aiCache` (serialise / loadState / save)**

Add `aiCache` everywhere `ghCache` appears in the persistence path:

1. In `serialise(...)`, add `aiCache: state.aiCache,` next to `ghCache`.
2. In `loadState`, after the `ghCache` hydration block, add a parallel block:

```ts
// aiCache: keep only well-shaped entries; drop anything malformed.
const aiCache = base.aiCache;
const rawAi = (parsed as { aiCache?: unknown }).aiCache;
if (rawAi && typeof rawAi === 'object') {
  for (const [key, entry] of Object.entries(rawAi as Record<string, unknown>)) {
    const e = entry as Partial<AiCacheEntry>;
    if (
      e &&
      typeof e.summary === 'string' &&
      Array.isArray(e.tags) &&
      typeof e.inputHash === 'string' &&
      typeof e.analyzedAt === 'string'
    ) {
      aiCache[key] = {
        summary: e.summary,
        tags: e.tags as string[],
        model: e.model ?? 'unknown',
        analyzedAt: e.analyzedAt,
        inputHash: e.inputHash,
      };
    }
  }
}
```

and add `aiCache` to the returned object: `return { settings, board, repoMetadata, ghCache, aiCache };`. 3. In the `set(...)` calls that spread persisted state on load (the two places that pass `ghCache: state.ghCache` / `ghCache: ...`), add `aiCache` alongside. 4. In `save()`, change the destructure to include `aiCache` and pass it to `serialise`:

```ts
const { settings, board, repoMetadata, ghCache, aiCache } = get();
const payload = serialise({ settings, board, repoMetadata, ghCache, aiCache });
```

5. Add the import: ensure `AiCacheEntry` (and `AiContext`, `AiResult`) are imported from `../types` at the top.

- [ ] **Step 2: Hydrate `Repo.aiSummary`/`aiTags` on scan**

In `scanAndDistribute`, where each scanned `Repo` is built and `gh` is hydrated
from `ghCache`, also hydrate AI fields from `aiCache`:

```ts
const ai = get().aiCache[repo.path];
return {
  ...repo,
  gh: get().ghCache[repo.path]?.gh ?? null,
  aiSummary: ai?.summary ?? null,
  aiTags: ai?.tags ?? null,
};
```

(Adapt to the exact mapping expression already used for `gh`; the point is to set `aiSummary`/`aiTags` from `aiCache[path]` the same way `gh` is set from `ghCache[path]`.)

After the scan completes and `enrichGit()` is kicked off, also fire-and-forget
`void get().enrichAi();`.

- [ ] **Step 3: Add the queue state + actions to the store interface and impl**

Add to the store state: `analyzingPaths: Set<string>;` (runtime-only, default `new Set()`) and `aiUnavailableReason: string | null;` (runtime-only, default `null`).

Add the actions:

```ts
  enrichAi: async () => {
    const targets = get().repos;
    for (const repo of targets) {
      // Skip if Apple Intelligence already reported unavailable this session.
      if (get().aiUnavailableReason !== null) break;
      const ctx = await buildAiContext(repo);
      const hash = inputHash(ctx);
      const cached = get().aiCache[repo.path];
      if (cached && cached.inputHash === hash) continue; // fresh — skip

      set((s) => ({ analyzingPaths: new Set(s.analyzingPaths).add(repo.path) }));
      let result: AiResult;
      try {
        const raw = await invoke<string>('ai_analyze', { context: ctx });
        result = JSON.parse(raw) as AiResult;
      } catch {
        result = { ok: false, error: 'generation' };
      }
      set((s) => {
        const next = new Set(s.analyzingPaths); next.delete(repo.path);
        return { analyzingPaths: next };
      });

      if (result.ok && result.summary) {
        const entry: AiCacheEntry = {
          summary: result.summary, tags: result.tags ?? [], model: result.model ?? 'unknown',
          analyzedAt: new Date().toISOString(), inputHash: hash,
        };
        set((s) => ({
          aiCache: { ...s.aiCache, [repo.path]: entry },
          repos: s.repos.map((r) =>
            r.path === repo.path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r),
        }));
        void get().save();
      } else if (result.error === 'unavailable') {
        set({ aiUnavailableReason: result.reason ?? 'unavailable' });
        break; // stop the queue — no point continuing this session
      }
      // other errors: skip this repo, continue.
    }
  },

  enrichAiOne: async (path) => {
    const repo = get().repos.find((r) => r.path === path);
    if (!repo) return;
    const ctx = await buildAiContext(repo);
    const hash = inputHash(ctx);
    set((s) => ({ analyzingPaths: new Set(s.analyzingPaths).add(path) }));
    let result: AiResult;
    try {
      result = JSON.parse(await invoke<string>('ai_analyze', { context: ctx })) as AiResult;
    } catch {
      result = { ok: false, error: 'generation' };
    }
    set((s) => { const n = new Set(s.analyzingPaths); n.delete(path); return { analyzingPaths: n }; });
    if (result.ok && result.summary) {
      const entry: AiCacheEntry = {
        summary: result.summary, tags: result.tags ?? [], model: result.model ?? 'unknown',
        analyzedAt: new Date().toISOString(), inputHash: hash,
      };
      set((s) => ({
        aiCache: { ...s.aiCache, [path]: entry },
        repos: s.repos.map((r) => (r.path === path ? { ...r, aiSummary: entry.summary, aiTags: entry.tags } : r)),
      }));
      void get().save();
    } else if (result.error === 'unavailable') {
      set({ aiUnavailableReason: result.reason ?? 'unavailable' });
    }
  },
```

Add the imports at the top: `import { buildAiContext, inputHash } from '../utils/aiContext';` and ensure `AiResult`, `AiCacheEntry` come from `../types`. Declare `enrichAi`, `enrichAiOne`, `analyzingPaths`, `aiUnavailableReason` in the store's TypeScript interface, and initialise `analyzingPaths: new Set()` and `aiUnavailableReason: null` in the initial state object(s).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/useBoardStore.ts
git commit -m "feat(ai): persist aiCache, hydrate on scan, serial enrichAi queue"
```

---

## Task 8: UI — analyzing indicator + unavailable banner

**Files:**

- Create: `src/components/AiBanner.tsx`
- Modify: `src/components/RepoCard.tsx`

- [ ] **Step 1: Write the failing test for `AiBanner`**

`src/components/AiBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiBanner } from './AiBanner';

vi.mock('../store/useBoardStore', () => ({
  useBoardStore: (sel: (s: unknown) => unknown) =>
    sel({ aiUnavailableReason: 'appleIntelligenceNotEnabled' }),
}));

describe('AiBanner', () => {
  it('renders the unavailable message when a reason is set', () => {
    const html = renderToStaticMarkup(<AiBanner />);
    expect(html).toContain('Apple Intelligence');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/AiBanner.test.tsx`
Expected: FAIL — cannot find module `./AiBanner`.

- [ ] **Step 3: Implement `AiBanner.tsx`**

```tsx
// AiBanner.tsx — one-time notice when on-device Apple Intelligence is unavailable.
// Reads aiUnavailableReason from the store; renders nothing when null.

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore';

const MESSAGE: Record<string, string> = {
  deviceNotEligible: 'This Mac cannot run Apple Intelligence, so AI summaries are disabled.',
  appleIntelligenceNotEnabled:
    'Apple Intelligence is off. Enable it in System Settings › Apple Intelligence to get AI summaries.',
  modelNotReady:
    'The Apple Intelligence model is still downloading. AI summaries will appear once it is ready.',
};

export function AiBanner() {
  const reason = useBoardStore((s) => s.aiUnavailableReason);
  const [dismissed, setDismissed] = useState(false);
  if (!reason || dismissed) return null;
  const msg = MESSAGE[reason] ?? 'Apple Intelligence is unavailable, so AI summaries are disabled.';
  return (
    <div
      className="flex items-center gap-2 bg-amber-500/15 text-navy text-xs px-3 py-2 border-b border-amber-500/30"
      role="status"
    >
      <Sparkles size={13} strokeWidth={2} className="text-amber-500 shrink-0" />
      <span className="flex-1">{msg}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-navy-light hover:text-navy"
        aria-label="Dismiss"
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/AiBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount `AiBanner` near the top of the board**

In `src/components/Board.tsx`, import `AiBanner` and render `<AiBanner />` just inside the top-level board container, above the columns (next to the existing toolbar/banner area). Run `npx tsc --noEmit` — expected clean.

- [ ] **Step 6: Add the "✨ analyzing…" indicator + force button to `RepoCard`**

In `src/components/RepoCard.tsx`:

1. Read the analyzing flag and the action:

```tsx
const analyzing = useBoardStore((s) => s.analyzingPaths.has(repo.path));
const enrichAiOne = useBoardStore((s) => s.enrichAiOne);
```

2. In the identity block, replace the description render so the indicator shows while analyzing and there is no summary yet:

```tsx
{
  analyzing && !d.description && (
    <p className="text-[12px] text-navy-light leading-snug flex items-center gap-1">
      <Sparkles size={11} strokeWidth={2} className="animate-pulse" /> analyzing…
    </p>
  );
}
{
  d.description && (
    <p className="text-[12px] text-navy leading-snug border-l-2 border-terracotta pl-2 line-clamp-2">
      {d.description}
    </p>
  );
}
```

3. Add `Sparkles` to the lucide import line.
4. Add a force-analyze button to the action row (before the refresh button):

```tsx
<button
  type="button"
  onClick={() => {
    void enrichAiOne(repo.path);
  }}
  disabled={analyzing}
  className={`${iconBtn} disabled:opacity-50`}
  title="Analyze with Apple Intelligence"
  aria-label="Analyze with AI"
>
  <Sparkles size={14} strokeWidth={1.75} className={analyzing ? 'animate-pulse' : ''} />
</button>
```

- [ ] **Step 7: Verify the existing RepoCard test still passes**

Run: `npx vitest run src/components/RepoCard.test.tsx`
Expected: PASS. The store mock in that test returns a plain object; add `analyzingPaths: new Set(), enrichAiOne: () => {}` to its mocked state so the new selectors resolve. Update the mock, re-run, expect PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/AiBanner.tsx src/components/AiBanner.test.tsx src/components/Board.tsx src/components/RepoCard.tsx src/components/RepoCard.test.tsx
git commit -m "feat(ai): analyzing indicator, force button, unavailable banner"
```

---

## Task 9: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Frontend tests**

Run: `npm test`
Expected: all suites pass (slice-1 suites + new `aiContext`, `AiBanner`, updated `RepoCard`).

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: tsc + vite clean.

- [ ] **Step 3: Rust build + tests**

Run: `cd src-tauri && cargo build && cargo test`
Expected: clean; `recent_commits_tests` and slice-1 `local_stats_tests` pass.

- [ ] **Step 4: Sidecar contract**

Run: `./src-tauri/binaries/coruro-ai-aarch64-apple-darwin --selftest`
Expected: `{"ok":true,...}` JSON. (Skip if the sidecar could not be built in this environment — note it in the report.)

- [ ] **Step 5: End-to-end smoke (manual)**

Run: `npm run tauri dev`. After a scan, confirm: on an Apple-Intelligence-enabled Mac, cards fill with AI summaries + tags within a few seconds (serial); the ✨ button forces a re-analyze; on a machine with AI off, the amber banner appears and cards simply show GitHub data. No UI blocking, no error storm.

- [ ] **Step 6: Final fixups commit (if needed)**

```bash
git add -A
git commit -m "chore(ai): verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** sidecar + availability (Task 1), bundle/capability (Task 2), `git_recent_commits` (Task 3), `ai_analyze` (Task 4), types (Task 5), bounded context + hash (Task 6), persistence/hydration/serial queue/unavailable-stop (Task 7), analyzing indicator + force button + banner (Task 8), verification incl. `--selftest` (Task 9). All spec sections mapped.
- **Type consistency:** `AiContext` (camelCase) is shared by `aiContext.ts`, the `ai_analyze` Rust `AiContext` (serde camelCase), and `invoke('ai_analyze', { context })`. `AiResult` error union matches the sidecar's emitted `error` strings (`unavailable | contextOverflow | generation | badInput`) plus Rust-injected `timeout | sidecar_missing`. `AiCacheEntry` fields (`summary, tags, model, analyzedAt, inputHash`) are identical across types, store persistence, and hydration.
- **Freshness:** `enrichAi` skips repos whose `aiCache.inputHash` matches the freshly built context hash — no recompute on unchanged repos. `enrichAiOne` always re-runs (force).
- **Graceful failure:** `unavailable` stops the queue + sets the banner; all other errors skip one repo and continue; scan/GitHub/UI never block on AI.
- **Deferred:** long-lived sidecar process, signing/notarization, embeddings/search, `tokenCount` budgeting — out of scope, listed in the spec.
