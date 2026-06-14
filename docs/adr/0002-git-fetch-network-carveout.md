# 2. git_fetch is the sole networked git command

Status: Accepted

## Context

Invariant #4 is that Coruro's git operations are read-only on the user's repos.
But the sync feature needs `git fetch`, which both touches the network and writes
to `.git` (remote-tracking refs / `FETCH_HEAD`). Removing it would break a
working feature; leaving the invariant stated as an absolute would make it false.

## Decision

Scope the invariant with an explicit carve-out: `git_fetch` is the **sole**
`git_*` command permitted to touch the network, and it updates remote-tracking
refs / `FETCH_HEAD` only — never the working tree or `HEAD`. Every other `git_*`
command uses a read-only verb (`rev-list`, `branch`, `log`, `status`, `diff`,
`ls-files`).

This is locked by `git_boundary_tests` in `commands.rs`, which scan the file's
own source: exactly one quoted `fetch` arg, and zero mutating/extra-network verbs
(`push`, `pull`, `clone`, `commit`, `merge`, `rebase`, `reset`, `checkout`, …).
Adding a networked or working-tree-mutating git verb fails CI.

## Consequences

- The sync feature keeps working; the invariant is precise rather than aspirational.
- Any future `git_*` command that reaches the network or mutates the tree breaks
  the test and must be justified by updating this ADR and the contract.
