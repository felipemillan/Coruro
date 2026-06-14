# 4. Adopt ESLint on a legacy codebase via a ratcheting suppression baseline

Status: Accepted

## Context

The project had no ESLint when the hardening work began. Turning on strict rules
(`complexity` ≤ 10, `max-depth` ≤ 3, `no-explicit-any`) surfaced ~76 pre-existing
violations, concentrated in the large files slated for later structural refactors.
Fixing all of them up front would have front-loaded the riskiest work into the
single "adopt a linter" commit, violating the small-reversible-commits principle.

## Decision

Keep the rules at **error** severity and capture the existing violations in
`eslint-suppressions.json` (ESLint's native bulk-suppressions) as a baseline. A
**new** violation fails the gate; the baseline only ever **shrinks** as code is
cleaned up. When a refactor removes a suppressed violation, ESLint reports an
"unused suppression" and the fix is to prune the baseline
(`npm run lint -- --prune-suppressions`).

## Consequences

- The gate is strict for all new code from day one, without a giant up-front rewrite.
- Progress is visible: the baseline file shrinks over time and should never grow.
- Contributors must never add new code to the baseline — fix the violation instead.
