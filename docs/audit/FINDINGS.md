# Coruro Hardening Audit — Findings (Phase 1)

_Generated from a 14-agent read-only audit (workflow wf_a98bfaa8). 74 raw findings deduped to 28. Every claim cites a real file+line. 3 of 5 invariants confirmed PASS; 2 flagged P0._

**Legend:** Effort S/M/L · Risk low/med/high · P0 = breaks a Coruro invariant.

## P0 — Invariant concerns (fix/decide first) (2)

### 1. P0 INVARIANT BREAK — git_fetch is NOT read-only on user repos. git_fetch runs `git -C <path> fetch`, which (a) performs an outbound network call to the repo's remote and (b) mutates the user's .git (writes FETCH_HEAD, updates remote-tracking refs). It is a registered Tauri command (lib.rs:19). This

- **Rules:** Invariant: Git ops read-only on user repos
- **Effort/Risk:** M/med · load-bearing · **P0**
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/commands.rs:159-172; /Users/admin/Github/Coruro/src-tauri/src/lib.rs:19`
- **Why:** git fetch writes into .git and reaches the network, so as written the invariant is violated. Resolution is a policy call: either add an explicit carve-out in the invariant doc (network is GitHub not the AI path; .git writes don't touch the working tree) or guard/remove git_fetch. Cheap to decide, P0 because it breaks a stated invariant.

### 2. P0 INVARIANT — sidecar context under 4096 tokens is only soft-enforced and only partially tested. The cap is a CHARACTER proxy (MAX_PAYLOAD_CHARS=6000, ~3.5 chars/token) in TS, tested only via JSON.stringify length on the ANALYZE path. The day_notes path uses a SEPARATE untested 8000-char cap (useBo

- **Rules:** Invariant: sidecar context under 4096-token window enforced+tested; Rule 7 (tests first-class); Rule 9 (boundaries)
- **Effort/Risk:** M/med · load-bearing · **P0**
- **Files:** `/Users/admin/Github/Coruro/src/utils/aiContext.ts:11-12,40-48; /Users/admin/Github/Coruro/src/utils/aiContext.test.ts:5-19; /Users/admin/Github/Coruro/src/store/useBoardStore.ts:1120-1125; /Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:289-292,320,395-398,433-436`
- **Why:** The constitution requires this window 'enforced+tested.' It is approximately enforced (chars not tokens) on one of (at least) two payload paths, and three of four sidecar modes have no enforced+tested upper bound. A CJK/code/punctuation-dense payload, a large ~/.claude curate inventory, or many-commit day_notes can exceed 4096 tokens while passing the char gate, leaving the untested Swift runtime catch as the only backstop — so the 'enforced+tested' claim is overstated. P0 because it concerns a named invariant.

## Load-bearing — change carefully (16)

### 1. The AiContext repo-context shape (repoName/description/languages/recentCommits/topEntries/readme) is hand-replicated across FIVE sites in three languages with no canonical source — the exact Rule 5 example. (1) TS interface AiContext; (2) TS RawParts — a byte-for-byte duplicate used only as assemble

- **Rules:** Rule 5 (one canonical AiContext source — named in constitution); Rule 4 (Rust<->TS and Rust<->Swift JSON contract is a priority deep-module surface)
- **Effort/Risk:** L/high · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/types.ts:82-89; /Users/admin/Github/Coruro/src/utils/aiContext.ts:14-21; /Users/admin/Github/Coruro/src-tauri/src/commands.rs:264-278,568-576; /Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:5-12`
- **Why:** This wire contract crosses two IPC boundaries with nothing enforcing agreement — no shared schema, no codegen, no contract test. The json! literal at commands.rs:568-576 re-spells the struct it already deserialized, so a typo there diverges the actual bytes from the struct's declared contract and compiles cleanly in all three languages, surfacing only as a blank AI result at runtime. Highest-leverage DRG concern; two cheap within-language wins exist (see quick-win finding).

### 2. The same multi-copy contract pattern repeats for EVERY sidecar mode and BOTH directions (request+response), not just AiContext. Requests: day_notes (TS AiDayNotesRepo + Swift DayNotesRequest.RepoEntry), enrich (Swift EnrichRequest.Item, with TS passing an UNTYPED serde_json::Value straight through R

- **Rules:** Rule 5 (DRY the decisions); Rule 4 (stdin/stdout JSON contract is a named priority surface); Rule 9 (shape mismatches swallowed silently)
- **Effort/Risk:** L/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/types.ts:92-99,452-455,463-474; /Users/admin/Github/Coruro/src-tauri/src/commands.rs:407-413,487-493,527-537; /Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:14-21,24-39,45-66,74-103`
- **Why:** Rule 5 names AiContext specifically, but the duplication is systemic across all four modes. The enrich path is most fragile: Rust forwards items as an opaque Value (commands.rs:408,411) so nothing constrains the {id,kind,context} shape Swift decodes — agreement is by hope, and drift is invisible until a human notices a blank result.

### 3. The four ai\_\* IPC commands are shallow pass-through pipes, not deep modules: each returns Result<String,String> of the sidecar's raw stdout line; Rust never deserializes; TS calls invoke<string>() then JSON.parse(raw) as T. The entire Swift response schema is hand-redeclared on the TS side with zero

- **Rules:** Rule 4 (narrow/deep interface — command's job is 'analyze a repo' but interface is 'opaque string'; 4 shallow wrappers instead of one deep run_sidecar_mode helper); Rule 5 (error-envelope decision duplicated); Rule 9 (boundary not validated in Rust)
- **Effort/Risk:** L/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/commands.rs:407-438 (ai_enrich),487-517 (ai_day_notes),526-564 (ai_curate),566-601 (ai_analyze); run_sidecar 304-325; resolve_sidecar 290-300; consumers /Users/admin/Github/Coruro/src/store/useBoardStore.ts:720-721,757,1133-1134; /Users/admin/Github/Coruro/src/store/useClaudeStore.ts:139-140,202-203,253-257; /Users/admin/Github/Coruro/src/types.ts:92-99`
- **Why:** The priority IPC surface carries a String the caller must re-parse and re-type, so any field rename in main.swift silently breaks the runtime casts with no compiler help. A change to the error envelope must be edited identically in four places. A deep command would return Result<AiResult,AiError> with Rust owning deserialization, and a single run_sidecar_mode(payload,timeout) helper would collapse the four wrappers and centralize the deliberate-but-error-prone 'always Ok(json-error)' boundary.

### 4. The sidecar JSON contract has NO real test coverage and there is no ai-sidecar/Tests target at all. main.swift exposes only a --selftest flag emitting a hardcoded AiResponse — it exercises the analyze response encoder but never the day_notes/enrich/curate request decoders, the stringly-typed mode di

- **Rules:** Rule 7 (tests first-class); Rule 4 (priority IPC + stdin/stdout surfaces untested); Rule 9 (ai_analyze always returns Ok(json-error) — untested); invariant: 4096 window enforced+tested
- **Effort/Risk:** L/high · load-bearing
- **Files:** `/Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:231-235 (only --selftest, no Tests/); /Users/admin/Github/Coruro/ai-sidecar/Package.swift (no test target); /Users/admin/Github/Coruro/src-tauri/src/commands.rs:217-235,253-263 (only 2 Rust tests),567-601 (ai_analyze); /Users/admin/Github/Coruro/src/store/useBoardStore.ts:707-757 (enrichAi/enrichAiOne)`
- **Why:** Two of three toolchains carry the safety-critical invariants (zero-network AI, secret-free scan, Keychain-only token, read-only git) and have near-zero coverage; the Swift contract has none. Because ai_analyze swallows all failures into Ok(json-error-string), a broken sidecar emits no error signal — so tests are the only line of defense and they don't exist. This is the single highest-value untested path in the codebase.

### 5. The PTY reader thread (~40 LOC: 8192 buffer, UTF-8 carry/valid_up_to logic, unsafe from_utf8_unchecked, pty-output emit, EOF child reap, pty-exit emit) is duplicated VERBATIM between pty_spawn (119-157) and pty_spawn_cmd (255-284); the code's own comment at line 253 says 'identical to pty_spawn'. Mo

- **Rules:** Rule 4 (two shallow commands instead of one deep spawn module + thin mode adapters); Rule 5/Rule 6 (self-admitted duplicate); Rule 1 (both fns inflated past cap); Rule 3 (duplicated 4-level nesting)
- **Effort/Risk:** M/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/pty.rs:44-160 (pty_spawn),207-287 (pty_spawn_cmd); reader thread 119-157 vs 255-284`
- **Why:** The load-bearing, subtle part (UTF-8 boundary carry, exit-code reaping, unsafe) is copy-pasted, so any fix to the carry/EOF logic must land in both copies or they drift. The author already flagged it. Extract spawn_pty_reader(reader, app, id, sessions) + a shared spawn_in_pty(cwd, script, env) so both Tauri commands become thin <40-LOC wrappers, keeping the 'never interpolate user input' security boundary in one reviewable place.

### 6. useBoardStore.ts is 1209 LOC (>2x the ~300-500 ceiling, largest TS file) and is a god store: one Zustand slice exposes ~35 actions mixing persistence (load/save/serialise/validateAppState), GitHub network enrichment, local-git enrichment, AI analysis, day-notes, chat-session CRUD, and ~8 near-identi

- **Rules:** Rule 2 (bounded files); Rule 4 (god store / shallow setters); Rule 5
- **Effort/Risk:** L/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/store/useBoardStore.ts:1-1209 (interface 61-174; settings setters; fetch loop 975-1042)`
- **Why:** The store mixes seven cohesive concerns that should be separate slices/modules; the inline GitHub fetch duplicates existing helpers. Splitting (day-notes slice, chat-sessions slice, github-fetch util) reduces blast radius and brings the file toward the band. Load-bearing because the store is the app's state core.

### 7. generateDayNotes is a ~277 LOC single action (~7x the 40-LOC unit cap) with 5-6 levels of nesting and inline network+parsing. It computes the time window, fetches login/events, then per-repo (repoData = Promise.all(repos.map(async...)), ~165 LOC) nests async fn -> if(coords&&token) -> defines fetchW

- **Rules:** Rule 1 (fn <=40 LOC); Rule 3 (cyclomatic <=10, nesting <=3); Rule 7 (testability follows from small units)
- **Effort/Risk:** L/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/store/useBoardStore.ts:894-1170 (per-repo block 942-1106; fetchWithTimeout 984-1000)`
- **Why:** A 277-LOC function with embedded IO, an inner fetch helper, and >10 branches cannot be branch-tested; extracting the pure window/dedup/cap logic (as was already done for aiContext.ts's pure core) is the path to testability and is the chief reason the store is hard to test.

### 8. AskTab is a ~670 LOC god component (~6 useState, 8 useRef, 8 useEffect, ~10 useCallback before a ~200 LOC return) and start (194-304) and handleRunBuild (392-451) duplicate PTY listener wiring: both attach pty-output/pty-exit listeners + buffersRef + updateChatSessionStatus, differing only in pty_sp

- **Rules:** Rule 1 (fn/component <=40 LOC); Rule 2; Rule 4 (DRY PTY-listener pass-through); Rule 7 (untested IPC critical path)
- **Effort/Risk:** L/high · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/components/AskTab.tsx:49-718 (start 194-304, handleRunBuild 392-451); /Users/admin/Github/Coruro/src-tauri/src/pty.rs:1-287`
- **Why:** Both functions plus the component blow the unit and file caps; a shared attachPtyListeners(id, term) helper removes the duplication. PTY lifecycle bugs (orphaned children, leaked sessions, kill-on-delete ordering) are exactly what tests catch, and the Ask feature is a core tab with no safety net. High risk to refactor (live PTY concurrency) — change carefully.

### 9. Module-level mutable singletons in useBoardStore.ts defeat test isolation: autoNotesTimerRef (177), notesSaveTimers Map (206), and writeChain Promise (214) are module globals, not store state, so tests cannot reset them between cases — a timer/debounce or pending writeChain leaks across the test run

- **Rules:** Rule 7 (tests); Rule 9 (hidden global state); Rule 4 (queue logic entangled with IO)
- **Effort/Risk:** M/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/store/useBoardStore.ts:176-177,205-206,214,707-775; test resetStore /Users/admin/Github/Coruro/src/__tests__/useBoardStore.generateDayNotes.test.ts:72-79`
- **Why:** These globals are real hidden state outside Zustand; the auto-notes test already had to fight an infinite-loop abort because of them. Because writeChain and the timer ref are not injectable/resettable, tests are order-sensitive and the queue/debounce/cache-skip behaviors can't be exercised in isolation. Pulling the skip decision into a pure predicate and making the timers resettable unblocks the most regression-prone untested paths.

### 10. RepoDetail is ~650 LOC (~18 useState/useRef, 6 useEffect, 5 useCallback, then one ~400 LOC createPortal JSX return). The GitHub overview band (603-689, ~85 LOC of conditional chips with nested ternaries e.g. ciStatus 625-637), notes-timeline (878-968), and branches panel (692-746) are large inline s

- **Rules:** Rule 1 (component <=40 LOC, <=3-4 props); Rule 2; Rule 3; Rule 4
- **Effort/Risk:** L/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/components/RepoDetail.tsx:325-976 (overview 603-689, branches 692-746, timeline 878-968); TreeRow 88-102`
- **Why:** The split pattern already exists in this file, so finishing it is low-risk and brings the component within caps; narrowing TreeRow's interface meets the prop limit. Medium leverage — pure presentational refactor.

### 11. CommandCenterTab (~750 LOC: 24 store selectors + 10 useState + 6 useMemo + 2 useEffect, then a ~550 LOC return switching on subTab inline — overview 503-677 nests section->grid->cond->map->cond repeatedly) and Settings (684 LOC: 22 useBoardStore selectors, ~495 LOC monolithic return of seven inline

- **Rules:** Rule 1 (component <=40 LOC); Rule 2; Rule 3
- **Effort/Risk:** L/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/components/CommandCenterTab.tsx:181-931 (overview 503-677); /Users/admin/Github/Coruro/src/components/Settings.tsx:58-684`
- **Why:** Each subTab body / settings section is an independent unit; extracting them shrinks both the component size and the per-component selector surface. Handlers are already small and memoized, so the work is mechanical view extraction. CommandCenterTab is load-bearing (security-relevant scanner UI); Settings is a safer mechanical split.

### 12. claudeScanner.ts is 846 LOC (~1.7x ceiling). It is well-decomposed into small per-category scanners (scanMcpServers/scanSkills/scanAgents/scanCommands/scanPlugins/scanHooks/scanSessions) so unit rules largely hold, but the aggregate is over the file cap; raw-shape interfaces (133-217), MCP helpers,

- **Rules:** Rule 2 (~300-500 LOC); Rule 1 (scanClaude >40 LOC); Rule 6 (DRY boilerplate)
- **Effort/Risk:** M/low · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/utils/claudeScanner.ts:1-846; scanClaude 704-846 (IIFE blocks 745-817)`
- **Why:** Lowest-severity Rule-2 hit because cohesion is high, but the runScan helper is a near-free win that flattens scanClaude toward the unit cap and removes nine duplicated error strings. The Command Center scanner is load-bearing (secret-free invariant), so module moves should be careful.

### 13. Several Rust units exceed caps and re-read/duplicate work. pty_spawn (~110 LOC) does arg validation + openpty + two-branch zsh script + CommandBuilder + spawn + reader/writer + session insert + a ~40-line reader-thread closure nesting loop>match>Ok arm>inner match>if (~4 levels). pty_spawn_cmd (~80

- **Rules:** Rule 1 (unit <=40 LOC); Rule 3 (nesting <=3); DRY
- **Effort/Risk:** M/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/pty.rs:44-160,207-287; /Users/admin/Github/Coruro/src-tauri/src/commands.rs:617-701 (Node branch 632-678),377-398`
- **Why:** detect_repo_type parses the same file from disk twice; the numstat loop and reader threads exceed the nesting cap. Small guard-clause extractions halve the IO and flatten nesting. The pty extractions overlap with the reader-thread dedup finding above (do them together).

### 14. main.swift is one 439-LOC top-level script with the entire dispatch at file scope (~210-LOC effective 'main', 230-439). The four mode handlers (day_notes 257-297, enrich 299-360, curate 362-403, analyze 405-439) are inlined with no function extraction. Within them, the 5-arm SystemLanguageModel.defa

- **Rules:** Rule 1 (unit <=40 LOC — script body is the unit); Rule 3 (repeated 5-branch switch, IIFE complexity); Rule 6 (one style, intention-revealing); DRY
- **Effort/Risk:** M/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:230-439; availability 264-275,306-317,369-380,412-423; IIFE 289-291,395-397,433-435; emit* 142-160`
- **Why:** Each mode block is a cohesive routine; pulling them into named handlers gets every unit <40 LOC and lets the contract structs/handlers move toward separate files. The checkAvailability helper also ensures every mode treats model-unavailability identically (relevant to the zero-network on-device guarantee), and isContextOverflow replaces an obscure idiom with a readable named test. Load-bearing because it's the on-device AI layer.

### 15. validateAppState is a ~135 LOC function (~3x the unit cap) validating 7 persisted slices inline (settings/board/repoMetadata/ghCache/aiCache/dayNotes/chatSessions), each with its own nested object/array/typeof guards; the dayNotes filter (310-320) and chatSessions filter+map (334-352) reach object->

- **Rules:** Rule 1 (fn <=40 LOC); Rule 3 (nesting <=3)
- **Effort/Risk:** M/med · load-bearing
- **Files:** `/Users/admin/Github/Coruro/src/store/useBoardStore.ts:222-357`
- **Why:** Natural decomposition into per-slice validators; load-bearing because it gates what persisted state is trusted on load. Medium risk — validation logic should not change behavior during the split.

### 16. Positive invariant confirmations (grounded, reported to avoid inventing problems — no action needed). INVARIANT 1 zero-network: PASS — main.swift has no URLSession/http/socket/Network matches; uses only FoundationModels + FileHandle stdin/stdout; all four AI entrypoints reach the model via run_sidec

- **Rules:** Invariants 1, 2, 3 (confirmed satisfied)
- **Effort/Risk:** S/low · load-bearing
- **Files:** `/Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:1-440,74-96; /Users/admin/Github/Coruro/src-tauri/src/commands.rs:1-41,304-325,318; /Users/admin/Github/Coruro/src-tauri/src/pty.rs:169; /Users/admin/Github/Coruro/src/utils/claudeScanner.ts:128-131,154-174,641,646-690,799-801; /Users/admin/Github/Coruro/src/utils/claudeCurate.ts:149-164`
- **Why:** Three of the five named invariants hold structurally and are documented here so the audit is balanced and the passing surfaces are not accidentally regressed. No change required; included for completeness, not as a defect.

## Quick wins — safe leverage (10)

### 1. All AI/sidecar parse failures in the store collapse to the single opaque error 'generation', discarding the typed taxonomy (unavailable \| contextOverflow \| timeout \| sidecar_missing \| badInput \| generation) that the sidecar and Rust layer go to lengths to produce. A JSON.parse throw, a thrown i

- **Rules:** Rule 9 (explicit errors — typed error contract flattened/swallowed)
- **Effort/Risk:** S/low
- **Files:** `/Users/admin/Github/Coruro/src/store/useBoardStore.ts:718-724,754-760; AiResult error union /Users/admin/Github/Coruro/src/types.ts:97; emitters /Users/admin/Github/Coruro/src-tauri/src/commands.rs:587-600; /Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:412-438`
- **Why:** commands.rs and main.swift emit a precise error envelope and types.ts:97 declares the full union, but the store's catch overwrites every distinct cause, defeating the careful typing one layer down. High leverage: small, localized fix that recovers user-facing diagnostics for the AI path.

### 2. ai_analyze should serialize the typed AiContext struct directly instead of re-listing every field in its json! literal. The struct already declares #[serde(rename_all="camelCase")] so serde emits identical keys, collapsing two of the AiContext copies into one and removing the hand-typed key list tha

- **Rules:** Rule 5 (DRY); Rule 6 (no redundant restatement)
- **Effort/Risk:** S/low
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/commands.rs:264-278,568-576; /Users/admin/Github/Coruro/src/utils/aiContext.ts:14-21`
- **Why:** Self-contained, reversible, within-language refactor that cuts the highest-risk drift point (the json! macro's plain string keys have no compiler check against the struct) and shrinks five AiContext copies to three with zero new tooling. Recommended pair of immediate steps before any cross-language codegen is considered.

### 3. buildAiContext swallows all three IO sources (git_recent_commits, readDir, README read) into empty/null with bare catches and no logging; refreshHasToken maps any Keychain access failure to hasToken=false; and four GitHub fetcher utils swallow every error (incl. 403/auth and 429/rate-limit) into []

- **Rules:** Rule 9 (swallowed errors at fs/git/keychain/network boundaries); Rule 4 (GitHub fetchers duplicate githubClient.ghJson); Rule 8 (0 docstrings on the fetchers)
- **Effort/Risk:** M/med
- **Files:** `/Users/admin/Github/Coruro/src/utils/aiContext.ts:66-100 (catches at 70,78,86); /Users/admin/Github/Coruro/src/store/useBoardStore.ts:1200-1207 (refreshHasToken); /Users/admin/Github/Coruro/src/utils/githubEvents.ts:23-38; /Users/admin/Github/Coruro/src/utils/githubPRDetails.ts:10-21; /Users/admin/Github/Coruro/src/utils/githubCI.ts:~21; /Users/admin/Github/Coruro/src/utils/githubUser.ts`
- **Why:** get_token (commands.rs:34-41) distinguishes NoEntry from a real Keychain error, and githubClient.ghJson (githubClient.ts:31-67) returns typed {data,status} with 429 distinguishable — but these consumers collapse those distinctions. A user hitting rate limits or with a locked keychain is silently downgraded (blank activity, unauthenticated 60 req/hr path, AI summarizing a blank repo) with no diagnostic. Reuse ghJson and surface status to fix the cluster.

### 4. No language/lint tooling exists for ANY of the three languages: no eslint/prettier/biome/rustfmt/clippy/swiftformat/swiftlint/editorconfig config (repo-wide search returned zero hits); package.json scripts are only dev/build/preview/tauri/test/test:watch with no lint/format; .vscode/ holds only exte

- **Rules:** Rule 6 (one enforced style); Rule 10 (automation)
- **Effort/Risk:** M/low
- **Files:** `/Users/admin/Github/Coruro/package.json:1-15; /Users/admin/Github/Coruro/.vscode/extensions.json:1-3; root (no eslint/prettier/rustfmt/clippy/swiftformat config)`
- **Why:** With three languages and zero formatters/linters, 'one style' is purely manual and unverifiable; a reviewer cannot run `lint` to catch drift, and a no-console rule would catch the 7 ungated console.debug calls. Adding linters is the prerequisite for the CI gate below.

### 5. No CI and no one-command cross-language gate or setup. .github/workflows does not exist (confirmed absent); the root Justfile only does `import 'Justfile.crew'` (bigbang-crew partial) and defines zero Coruro build/test/lint recipes; package.json scripts are JS-only. Nothing runs vitest + cargo test

- **Rules:** Rule 10 (one-command setup+gate across 3 langs, CI); Rule 7 (tests not gate-enforced)
- **Effort/Risk:** M/low
- **Files:** `/Users/admin/Github/Coruro/.github/workflows (absent); /Users/admin/Github/Coruro/Justfile:1-3; /Users/admin/Github/Coruro/package.json:6-13; /Users/admin/Github/Coruro/scripts/build-ai-sidecar.sh:1-24; /Users/admin/Github/Coruro/README.md:64-84`
- **Why:** A tri-language app with hard zero-network and 4096-token invariants has no automated guard against regressions — any P0 invariant could break and nothing would catch it. Tests that no pipeline runs are not 'first-class'; with Swift=0 and Rust smoke-only coverage, gaps go unnoticed. Wiring a `just gate` (vitest + cargo test + swift test) plus a minimal CI workflow is the leverage point that makes every other test/invariant finding enforceable.

### 6. No language/toolchain version pins and loose dependency manifests. No rust-toolchain.toml, no .nvmrc/.node-version, no package.json engines field; required versions (Node 20+, Rust stable, Xcode 26/macOS 26 SDK) live only in README prose. Cargo.toml uses caret ranges (tauri="2", serde="1", tokio="1"

- **Rules:** Rule 10 (pinned deps / reproducibility)
- **Effort/Risk:** S/low
- **Files:** `/Users/admin/Github/Coruro/src-tauri/Cargo.toml:18-31; /Users/admin/Github/Coruro/package.json:14-43; /Users/admin/Github/Coruro/README.md:64-68; (no rust-toolchain.toml/.nvmrc; Package.swift:6 good)`
- **Why:** Without pinned toolchains a contributor on the wrong Rust/Node version gets non-reproducible builds, and the macOS-26/Swift-6/FoundationModels requirement is enforced only by build failure. Hygiene note, not a hard break (lockfiles hold reproducibility when cargo build / npm ci are used). Cheap to add a rust-toolchain.toml + .nvmrc + engines.

### 7. No ARCHITECTURE.md, no CONTRIBUTING.md, no ADR directory. The tri-language design (React store -> Tauri IPC -> Swift sidecar), the ~27 Tauri commands and their contracts, the 5 sidecar modes, the security invariants, and load-bearing decisions (AiContext hand-replicated, ai\_\* always return Ok(json-e

- **Rules:** Rule 8 (docs live with code: ARCHITECTURE.md/CONTRIBUTING.md/ADRs/docstrings on pub interfaces)
- **Effort/Risk:** L/low
- **Files:** `/Users/admin/Github/Coruro/ (no ARCHITECTURE.md/CONTRIBUTING.md/docs/adr/); /Users/admin/Github/Coruro/README.md:1-110; /Users/admin/Github/Coruro/src-tauri/src/lib.rs:5 (pub fn run, no ///); /Users/admin/Github/Coruro/src/types.ts:81-89; /Users/admin/Github/Coruro/src-tauri/src/commands.rs:264-278,567-601; /Users/admin/Github/Coruro/ai-sidecar/Sources/coruro-ai/main.swift:5-12`
- **Why:** A newcomer onboarding to a tri-language Tauri app has no top-level map and must read useBoardStore.ts (1209 LOC) + commands.rs to learn the IPC surface. An ADR naming the canonical AiContext source and documenting the deliberate Ok-always boundary is the cheapest mitigation short of codegen; a docstring on run() is the single highest-value doc addition.

### 8. commands.rs is 701 LOC (~40% over ceiling) mixing five separable concerns: Keychain PAT storage (store*token/get_token), GUI launchers (open_in_editor/open_in_terminal), read-only git inspection (8 git*\* fns), the AI sidecar layer (resolve_sidecar/run_sidecar/ai_analyze/ai_day_notes/ai_enrich/ai_cur

- **Rules:** Rule 2 (bounded files); Rule 4 (separable deep modules)
- **Effort/Risk:** M/low
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/commands.rs:1-701`
- **Why:** A single file holding keychain, process launching, git, AI IPC, and fs detection forces unrelated changes to touch one blast-radius file and is hard to review. Mechanical module split, low risk.

### 9. Several shallow Rust commands leak implementation shape or duplicate one another. git_ahead_behind returns Option<(i64,i64)> and git_local_stats returns (i64, Option<String>, i64) — positional tuples with no field names, so TS destructures by position (git_ahead_behind's comment even notes git outpu

- **Rules:** Rule 4 (narrow interface — return named structs not positional tuples; shallow pass-through command)
- **Effort/Risk:** S/low
- **Files:** `/Users/admin/Github/Coruro/src-tauri/src/commands.rs:115-133 (git_ahead_behind),180-215 (git_local_stats),54-79 (open_in_editor),88-102 (open_in_terminal); named structs 346-355,607-612`
- **Why:** Positional tuples push column-order knowledge across the IPC boundary; named structs (already used elsewhere) make the contract self-describing. open_in_terminal duplicates a launcher branch verbatim. Small, low-risk consistency fixes.

### 10. CommandPalette return is ~355 LOC with three structurally identical CommandGroup blocks — Skills (272-316), Agents (321-364), Commands (369-412) — each map->CommandItem with the same value/onSelect/ItemLabel/source-badge markup, differing only in the \*Invocation helper and icon. They could collapse

- **Rules:** Rule 1 (component <=40 LOC); Rule 6 (no duplicated blocks); Rule 2
- **Effort/Risk:** M/low
- **Files:** `/Users/admin/Github/Coruro/src/components/CommandPalette.tsx:241-596 (Skills 272-316, Agents 321-364, Commands 369-412, footer 538-593)`
- **Why:** Three copy-paste groups are a clear DRY collapse with low risk (pure presentational). Removes ~120 LOC and brings the return toward the cap.
