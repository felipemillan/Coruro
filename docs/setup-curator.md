# Setup Curator

The **Curate** sub-tab of the Claude Command Center judges your scanned
`~/.claude` inventory and surfaces actionable findings — what to remove,
consolidate, or revisit — plus an additive, on-device AI narrative.

It answers the question the rest of the Command Center doesn't: *given
everything I have installed, what should I actually clean up?*

## What it finds

Findings are grouped by category, rendered actionable-first:

| Category | Heuristic |
|----------|-----------|
| **Remove** | Plugins with `enabled === false`. Project-scoped MCP servers whose project has no active session (orphans). |
| **Consolidate** | Skills / agents / commands whose name exists in both a `local` source and a non-local (plugin) source — duplicate or shadowing. |
| **Stale / unused** | Sessions idle longer than `STALE_DAYS` (90 days). |
| **Gap / Keep** | Reserved in the category union for the AI narrator and a future deterministic slice; not emitted in v1. |

Each finding carries a `severity` (`info` | `warn`); `warn` findings get a
terracotta left border.

## Two layers, clearly separated

1. **Deterministic findings (TypeScript).** `buildCurateFindings(inventory)` in
   `src/utils/claudeCurate.ts` computes everything from verified inventory
   fields. These render **instantly** and **never depend on AI availability**.
   All numbers shown in the UI come from here.
2. **Additive AI narrative (on-device).** A new `curate` sidecar mode produces a
   short, qualitative prose summary over the findings. It is number-free by
   design — the `@Guide` copies the day-notes discipline ("never repeat, sum,
   count, or compute numbers; never invent"). If Apple Intelligence is
   unavailable, the findings still render; the narrative banner is simply
   omitted (no scary error).

## Secret-free guarantee

The Curator upholds the Command Center's read-only, secret-free contract. The
payload sent to the model carries finding **`title` strings only** — never
`detail` (which holds counts) and never `items` (which hold names/paths). The
Swift `Finding` struct has no `detail` field at all, closing the leak vector at
the type level. No transcript bodies, env-var values, or raw MCP commands are
ever read.

## "Ask Claude to fix"

Every finding card has an **Ask Claude to fix** button. It builds a
natural-language prompt (category-specific, listing up to 25 items) and hands it
to a real Claude session via the existing Ask bridge
(`useViewStore.requestAskCommand`), with cwd resolved to `~/.claude`. The
Curator never mutates your setup itself — execution is delegated to Claude with
you in the loop. Deletion prompts ask Claude to confirm each item before acting.

## Architecture

No MCP server. Reuses the proven Swift FoundationModels sidecar pattern, the
same path as `ai_day_notes` / `ai_enrich`.

```
TS buildCuratePayload(findings)
   └─► invoke('ai_curate', { findings, summary })          # arg names match Rust
Rust ai_curate(findings, summary)
   └─► {mode:"curate", findings, summary} + '\n' ─► sidecar  # 90s timeout
Swift CurateRequest { mode, findings:[{id,category,title}], summary:{5 keys} }
   └─► @Generable CurateSummary { @Guide var narrative }
```

The category union (`remove | consolidate | stale | gap | keep`) and the
zero-filled 5-key `summary` are identical across TypeScript, Rust, and Swift —
a single locked contract.

## Files

- `src/utils/claudeCurate.ts` — deterministic heuristics + title-only payload
- `src/components/claude/Recommendations.tsx` — the Curate tab UI
- `src/components/claude/markdownComponents.tsx` — shared markdown renderers
- `src/store/useClaudeStore.ts` — `generateRecommendations()`
- `ai-sidecar/Sources/coruro-ai/main.swift` — `curate` mode
- `src-tauri/src/commands.rs` — `ai_curate` command

## Out of scope (v1)

MCP server; transcript parsing / true per-item usage counts; a `cost` /
context-budget category; auto-applying changes.
