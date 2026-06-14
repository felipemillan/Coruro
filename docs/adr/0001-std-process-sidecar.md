# 1. Spawn the AI sidecar with std::process, not shell().sidecar()

Status: Accepted

## Context

The on-device AI lives in a Swift sidecar binary (`coruro-ai`). Tauri offers
`shell().sidecar()` to spawn bundled side binaries, and that is the documented
path. In practice it resolved unreliably in the packaged release bundle —
spawning with `ENOENT` even with the binary present in `Contents/MacOS/`.

## Decision

Resolve the sidecar's absolute path ourselves from `current_exe()` (checking both
the stripped name and the target-triple-suffixed name) and spawn it directly with
`std::process::Command`. Communication is one newline-terminated JSON line in on
stdin, one JSON line out on stdout. The single owner of spawn + timeout +
error-classification policy is `run_sidecar_mode` in `commands.rs`.

## Consequences

- Reliable spawning in both `tauri dev` and the release bundle.
- We own path resolution, so the sidecar must sit next to the main executable;
  `just sidecar-build` copies it into `src-tauri/binaries/`.
- Every failure mode (missing binary, spawn error, timeout, empty output) maps to
  a well-formed synthetic error JSON, so the caller always parses a result.
