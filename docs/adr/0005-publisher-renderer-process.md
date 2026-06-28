# 5. Render Publisher assets with a Node + Playwright process, not in-app or in Rust

Status: Accepted

> Numbering note: this ADR was briefed as 0004, but `0004-eslint-suppression-baseline.md`
> already occupies that number, so it lands as 0005.

## Context

The Publisher needs to turn the app's existing Neo-Brutalist cards (the
`DailyNoteBento`, `RepoCard`) into static social-card PNGs for assisted-manual
publishing. The cards are real React + Tailwind components styled by the nb-\*
primitives in `src/index.css`; reproducing their pixels any other way (canvas,
SVG, a Rust drawing crate) would fork the design and rot. Rendering them faithfully
requires a real browser engine. The Rust backend has no mature, maintained CDP /
headless-Chromium binding, and rendering inside the running Tauri webview would
couple asset generation to the live UI and its stores.

## Decision

Render off-process, mirroring ADR 0001's std::process sidecar pattern.
`src-tauri/src/publisher.rs` spawns a standalone Node script
(`publisher-renderer/render.mjs`) over stdio: one JSON line in
(`{repo,target,data,outDir}`), one JSON line out (`{assets:[...absolute paths]}`).
The script drives **headless Chromium via Playwright**, loads a dedicated Vite
build entry (`dist/offscreen.html` → `src/publisher/offscreen.tsx`) over `file://`,
injects the payload via `addInitScript`, waits for the nb-\* tree to settle, and
screenshots each `.coruro-card-page` to a PNG. The renderer is its **own npm
package** (`coruro-publisher-renderer`), kept out of the root workspace so its
Chromium dependency never enters the root gate.

## Consequences

- Assets are the real components' pixels; design stays single-sourced in `src/`.
- **Chromium-bearing and LOCAL ONLY.** The renderer loads only `file://` /
  `127.0.0.1` origins and runs offline; it is NOT the zero-network FoundationModels
  sidecar and does no AI work. Absolute asset paths stay runtime-only and never
  enter persisted `AppState`.
- Like the Swift sidecar, the package is **excluded from CI / `just gate`** and
  activated on demand: `cd publisher-renderer && npm install && npx playwright
install chromium`. CI does not download a browser.
- The Integration agent must add a second Vite input
  (`offscreen: resolve(__dirname, 'offscreen.html')`) so `vite build` emits
  `dist/offscreen.html` alongside the app shell.
