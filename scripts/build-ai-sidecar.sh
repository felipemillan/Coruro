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

# `tauri dev` resolves the sidecar next to the dev executable (target/debug),
# not from src-tauri/binaries. Place dev copies so the sidecar spawns in dev.
# (A release `tauri build` bundles the externalBin itself; these are dev-only.)
DEBUG_DIR="../src-tauri/target/debug"
if [ -d "$DEBUG_DIR" ]; then
  mkdir -p "$DEBUG_DIR/binaries"
  for p in "$DEBUG_DIR/coruro-ai" "$DEBUG_DIR/coruro-ai-aarch64-apple-darwin" \
           "$DEBUG_DIR/binaries/coruro-ai" "$DEBUG_DIR/binaries/coruro-ai-aarch64-apple-darwin"; do
    cp "$BIN" "$p"
  done
  echo "Placed dev copies under $DEBUG_DIR"
fi
