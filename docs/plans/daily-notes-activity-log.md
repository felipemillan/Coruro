# Daily Notes — Track 1: In-App Activity Log

Status: planned · Owner: TBD · Target: passes `just gate` (vitest + tsc + lint + rust + swift)

## Overview

Track 1 of the hybrid Daily Notes vision adds an **in-app Activity Log** so Daily Notes capture app usage (Ask/Claude sessions, Command Center opens, Setup Curator runs, Run-commands, user notes written) — not just git/repo work. The log is **metadata-only, secret-free, and zero-network**, and is wired into `generateDayNotes` so a note is emitted even on days with zero repo commits, with a deterministic `## App Activity` section.

Two P0 invariants govern this work:
- **Invariant #1 (zero-network AI):** the activity log never triggers a network call; the on-device sidecar is never invoked with empty repo data on the app-only path.
- **Invariant #2 (secret-free):** no prompt bodies, transcript content, absolute filesystem paths, or token values are ever persisted or rendered. Only `repoName` slugs and a constrained, enum-ish `label` are stored.

### Canonical design decisions (resolving scout divergence)

| Decision | Resolution | Rejected alternative |
|---|---|---|
| Type names | `ActivityEvent` / `ActivityEventKind` / `ActivityLogState`; AppState field `activityLog` | `AppActivityEvent` / `appActivity` (INTEGRATION scout) |
| Slice location | dedicated `src/store/activityLogSlice.ts` | co-locate in `chatSessionsSlice.ts` (INTEGRATION) |
| `logActivity` signature | object arg: `logActivity(event: ActivityEvent)` — callers build the full event (matches `addChatSession`/`addDayNote`) | `logActivity(kind, repoName, label?)` positional (GUARD) |
| Cap | `MAX_ACTIVITY_EVENTS = 500`, enforced in-slice **and** on-load | 200 (SLICE) |
| Window query | `eventsInWindow(windowStartIso, windowEndIso)` — ISO strings (the values already at dayNotesSlice line 129) | epoch-ms params (SLICE) |
| Label safety | validator rejects path-shaped / >200-char labels; report never renders labels | unguarded label (SLICE) |
| Secret-free test | compile-time `keyof ActivityEvent` exhaustiveness assertion | fragile fs source-scan regex (GUARD alt) |
| `run_command_fired` | distinct kind, logged at run-build/Run sites | conflate with `ask_session_started` |

`ActivityEventKind` = `'ask_session_started' | 'ask_session_ended' | 'command_center_opened' | 'curator_run' | 'run_command_fired' | 'user_note_written'`.

`ActivityEvent` = `{ id: string; ts: number; kind: ActivityEventKind; repoName: string | null; label?: string }`.

## Task table

| ID | Title | Complexity | Model | Files | Depends on | Group |
|----|-------|-----------|-------|-------|-----------|-------|
| T1 | Types + AppState field + createEmptyAppState | medium | sonnet | `src/types.ts` | — | W1 |
| T2 | `activityLogSlice.ts` (log/window/clear, 500 cap) | medium | sonnet | `src/store/activityLogSlice.ts` | T1 | W2 |
| T3 | BoardStore action signatures | low | haiku | `src/store/boardStoreTypes.ts` | T1 | W2 |
| T4 | `validateActivityLog` + secret-free label guard | high | opus | `src/utils/appStateValidation.ts` | T1 | W2 |
| T5 | Persistence wiring (serialise/validate/save/load/compose root) | high | opus | `boardStoreShared.ts`, `persistenceSlice.ts`, `useBoardStore.ts` | T2,T3,T4 | W3 |
| T6 | `composeSessionReport` App Activity section | high | opus | `src/utils/sessionReport.ts` | T1 | W2 |
| T7 | `generateDayNotes` integration + app-only note + `addUserNote` log | high | opus | `src/store/dayNotesSlice.ts` | T2,T3,T5,T6 | W4 |
| T8 | Ask/Run call-sites | medium | sonnet | `AskTab.tsx`, `ask/useAskTerminal.ts`, `TopActionBar.tsx` | T2,T3,T5 | W4 |
| T9 | Command Center open + Curator run call-sites | medium | sonnet | `App.tsx`, `useClaudeStore.ts` | T2,T3,T5 | W4 |
| T10 | Tests: activityLogSlice | medium | sonnet | `__tests__/activityLogSlice.test.ts` | T2,T5 | W5 |
| T11 | Tests: validateActivityLog + keyof assertion | medium | sonnet | `__tests__/appStateValidation.test.ts` | T4 | W5 |
| T12 | Tests: composeSessionReport section | low | haiku | `__tests__/sessionReport.test.ts` | T6 | W5 |
| T13 | Tests: generateDayNotes app-only note + resetStore seed | high | opus | `__tests__/useBoardStore.generateDayNotes.test.ts` | T7 | W5 |

## Wave sequencing

- **W1 — Foundation (serial):** T1. Every other task imports `ActivityEvent`; it must land first.
- **W2 — Parallel build (after T1):** T2, T3, T4, T6 — four disjoint files, no shared edits, run concurrently.
- **W3 — Convergence (serial, after T2+T3+T4):** T5 wires the slice through the persistence boundary and the composition root (`useBoardStore.ts`). Single integrator task; depends on the slice, the interface, and the validator all existing.
- **W4 — Call-site fan-out (parallel, after T5; T7 also waits on T6):** T7 (dayNotesSlice), T8 (Ask components), T9 (App + claudeStore) — disjoint files, run concurrently.
- **W5 — Test wave (parallel, each after its source):** T10, T11, T12, T13 — four disjoint test files, run concurrently.
- **Final gate:** run `just gate` once after W5; confirm vitest + tsc + lint (+ rust + swift) green.

Critical path: **T1 → {T2,T4,T6} → T5 → T7 → T13 → gate.**

## Insertion points (verified against source)

- `src/store/persistenceSlice.ts:75` — `save()` destructure adds `activityLog`; serialise call too.
- `src/store/persistenceSlice.ts:47–54` — `load()` `set({...})` block adds `activityLog: state.activityLog`.
- `src/store/boardStoreShared.ts:72,85` — `validateAppState` + `serialise` add the `activityLog` line (mirrors `chatSessions`).
- `src/store/dayNotesSlice.ts:144` — relax `if (activeRepoData.length === 0)` → `&& appEvents.length === 0`.
- `src/store/dayNotesSlice.ts:168` — pass `appEvents` as 4th `composeSessionReport` arg.
- `src/store/dayNotesSlice.ts:66` — `addUserNote` logs `user_note_written` after `addDayNote`.
- `src/utils/sessionReport.ts:184` — `composeSessionReport` gains optional 4th param `appEvents?`.
- `EXEC_SUMMARY_FALLBACK` (sessionReport.ts:117) and `model: 'local-stats'` (dayNotesSlice.ts:255) are reused for the app-only note.

## Risks

1. **Write-storm** — `logActivity` saves on every event; accepted (matches `addChatSession`), 500-cap keeps payload ~50KB. Debounce deferred.
2. **Secret-free (P0 #2)** — `label` is the only free-text field; guarded at three layers (call-site values, on-load validator, never-rendered) + compile-time keyof lock.
3. **Zero-network AI (P0 #1)** — app-only path short-circuits before `fetchExecSummary`; sidecar never sees empty repo data; T13 asserts no invoke.
4. **Cross-store import cycle** — T9 uses `useBoardStore.getState()` at call-time only; lazy import / runtimeEffects fallback if a cycle surfaces.
5. **Test state leak** — `resetStore()` must seed `activityLog:{events:[]}` (T13) or early-return tests fail.
6. **Validator/union drift** — `satisfies Set<ActivityEventKind>` makes a missing kind a tsc error.
7. **command_center over-count** — log on App.tsx onClick (single user intent), not on tab mount.
8. **run vs ask conflation** — `run_command_fired` is a distinct kind at the run-build/Run sites.

## Invariants checklist (must hold at end state)

- [ ] No `ActivityEvent` field named prompt/body/transcript/content/token/message/secret (keyof test).
- [ ] No absolute path persisted (`repoName` slug only; validator rejects `/`-prefixed labels).
- [ ] Sidecar never called on the app-only-activity path (T13 invoke assertion).
- [ ] `composeSessionReport` renders kind+count+repoName only — no `label` text in note body (T12).
- [ ] `just gate` green: vitest, tsc, lint, rust, swift.
