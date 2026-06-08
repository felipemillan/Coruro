#!/usr/bin/env bash
# Build the Apple Intelligence sidecar and place it where Tauri expects it.
set -euo pipefail
cd "$(dirname "$0")/../ai-sidecar"
swift build -c release
BIN=".build/release/mygitdash-ai"
DEST="../src-tauri/binaries/mygitdash-ai-aarch64-apple-darwin"
mkdir -p "../src-tauri/binaries"
cp "$BIN" "$DEST"
echo "Placed sidecar at $DEST"
