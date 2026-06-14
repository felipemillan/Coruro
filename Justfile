# Project recipes — add your own below this import
import 'Justfile.crew'

# ── Quality gate ─────────────────────────────────────────────────────────────
# `just gate` is the one-command cross-language gate. Run it before every commit.

# Install deps/toolchains for a fresh checkout.
setup:
    npm install
    cd src-tauri && cargo fetch

# Full gate: TypeScript + Rust + (conditional) Swift.
gate: gate-ts gate-rust gate-swift

# TypeScript: typecheck, lint (baseline-suppressed), format check, tests.
gate-ts:
    npm run typecheck
    npm run lint
    npm run format:check
    npm test

# Rust: format check + clippy (deny-level lints from Cargo.toml [lints]).
gate-rust:
    cd src-tauri && cargo fmt --check
    cd src-tauri && cargo clippy

# Swift sidecar: conditional — skips cleanly when the toolchain/linters are
# absent (e.g. CI has no macOS-26 FoundationModels runner).
gate-swift:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v swift >/dev/null 2>&1; then
      (cd ai-sidecar && swift build)
    else
      echo "swift not installed — skipping sidecar build gate"
    fi
    if command -v swiftformat >/dev/null 2>&1; then
      (cd ai-sidecar && swiftformat --lint .)
    else
      echo "swiftformat not installed — skipping sidecar format gate"
    fi
    if command -v swiftlint >/dev/null 2>&1; then
      (cd ai-sidecar && swiftlint)
    else
      echo "swiftlint not installed — skipping sidecar lint gate"
    fi

# Build the on-device AI sidecar binary into src-tauri/binaries/.
sidecar-build:
    ./scripts/build-ai-sidecar.sh

# Smoke-test the sidecar's offline self-test path.
sidecar-smoke:
    cd ai-sidecar && swift run coruro-ai --selftest
