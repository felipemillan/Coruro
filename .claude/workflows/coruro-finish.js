export const meta = {
  name: 'coruro-finish',
  description:
    'Finish the planned Coruro refactors (god-store split + 6 oversized files) as parallel worktree agents; each returns a gate-green patch or skips. Integrator applies sequentially.',
  phases: [{ title: 'Implement', detail: 'one worktree agent per oversized file; TS gate-green or skip' }],
};

// Each target is an INDEPENDENT file (distinct paths), so worktree agents do not
// collide and their patches apply independently on top of the same main HEAD.
const TARGETS = [
  {
    key: 'useBoardStore',
    file: 'src/store/useBoardStore.ts',
    brief:
      'Split this ~1180-LOC god store into slice-creator functions (persistence / enrich / dayNotes / chatSessions / settings) that compose into the SAME useBoardStore identity and BoardStore type. Extract pure helpers (e.g. a dayNotesWindow module and github day-notes helpers reusing ghJson) and shrink generateDayNotes from ~277 LOC to ~40 by moving pure logic out. Move module-global mutables (autoNotesTimerRef, notesSaveTimers, writeChain) into a small resettable runtimeEffects module. The public hook API, the BoardStore type, and the persisted ~/.repo_dashboard_state.json schema/filename MUST be unchanged.',
  },
  {
    key: 'RepoDetail',
    file: 'src/components/RepoDetail.tsx',
    brief:
      'Extract sections/sub-components into a new src/components/repoDetail/ directory to bring this file under 500 LOC. Behavior, props, and exports unchanged.',
  },
  {
    key: 'CommandCenterTab',
    file: 'src/components/CommandCenterTab.tsx',
    brief:
      'Extract sub-views/sections into src/components/claude/ (or a new commandCenter/ dir) to bring this file under 500 LOC. Behavior and exports unchanged.',
  },
  {
    key: 'claudeScanner',
    file: 'src/utils/claudeScanner.ts',
    brief:
      'Split this ~846-LOC scanner into per-source helper modules while keeping every exported symbol and its signature identical. Under 500 LOC.',
  },
  {
    key: 'AskTab',
    file: 'src/components/AskTab.tsx',
    brief:
      'Extract sidebar / terminal / session-list sub-components into src/components/ask/ to bring this file under 500 LOC. Behavior, props, and the PTY/session wiring unchanged.',
  },
  {
    key: 'Settings',
    file: 'src/components/Settings.tsx',
    brief:
      'Extract each settings section into its own sub-component under src/components/settings/. Under 500 LOC, behavior unchanged.',
  },
  {
    key: 'CommandPalette',
    file: 'src/components/CommandPalette.tsx',
    brief:
      'Extract command groups / providers into sub-modules. Under 500 LOC, behavior unchanged.',
  },
];

const PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary'],
  properties: {
    status: { enum: ['green', 'skipped'], description: 'green only if the TS gate passed' },
    summary: { type: 'string', description: 'one paragraph: what was split into what' },
    reason: { type: 'string', description: 'if skipped, why (e.g. could not keep tests green safely)' },
    loc_before: { type: 'number' },
    loc_after_main_file: { type: 'number' },
    diff: {
      type: 'string',
      description: 'full output of `git add -A && git diff --cached` (empty string when skipped)',
    },
  },
};

function implPrompt(t) {
  return `You are an expert refactorer working on the Coruro repo (Tauri 2 + React 19 + TypeScript) inside an ISOLATED git worktree. Your worktree has NO node_modules yet.

FIRST: run \`npm ci\` (the worktree needs dependencies before any gate command).

TASK: ${t.brief}
TARGET FILE: ${t.file}

HARD RULES — violating any means you must return status="skipped":
- Behavior-preserving ONLY. No feature, UX, or output change. No change to any public API, prop, or export signature.
- Do NOT change any persisted-state schema or the ~/.repo_dashboard_state.json filename/shape.
- Do NOT weaken a Coruro invariant (zero-network AI; secret-free Command Center; Keychain-only token; git read-only; sidecar < 4096 tokens). See ARCHITECTURE.md.
- Do NOT edit eslint-suppressions.json, package-lock.json, or any config file — the integrator handles those.
- Extracted code goes into new files in a sensible subdir; keep all imports working.
- Match the surrounding code style and run \`npx prettier --write\` on every file you change.

VERIFY (must all pass before you may return status="green"):
  npm run typecheck
  npx eslint <every file you created or changed>   (zero errors; warnings ok)
  npx vitest run                                    (all tests green)

RETURN via StructuredOutput:
- Gate green  -> status="green", summary, loc_before, loc_after_main_file, and diff = full output of \`git add -A && git diff --cached\`.
- Otherwise   -> status="skipped" with a concrete reason. NEVER return a broken or behavior-changing diff. A clean skip is better than a risky patch.`;
}

const results = await parallel(
  TARGETS.map((t) => () =>
    agent(implPrompt(t), {
      label: `split:${t.key}`,
      phase: 'Implement',
      schema: PATCH_SCHEMA,
      isolation: 'worktree',
    }).then((r) => ({ key: t.key, file: t.file, ...(r || { status: 'skipped', reason: 'agent returned null' }) })),
  ),
);

const green = results.filter((r) => r && r.status === 'green' && r.diff && r.diff.trim().length > 0);
const skipped = results.filter((r) => !r || r.status !== 'green');

log(`coruro-finish: ${green.length} green, ${skipped.length} skipped`);

return {
  green: green.map((r) => ({ key: r.key, file: r.file, summary: r.summary, loc_before: r.loc_before, loc_after_main_file: r.loc_after_main_file, diff: r.diff })),
  skipped: skipped.map((r) => ({ key: r.key, file: r.file, reason: r.reason || r.summary || 'unknown' })),
};
