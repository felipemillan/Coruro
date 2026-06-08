# Context

**Current Task:** Built Coruro release app with new icon; consolidated nav into Toolbar; merged work to `main`.

**Key Decisions:**
- New Coruro icon regenerated across all icon files; nav header removed, brand + Settings gear moved into Toolbar.
- Release build via `npm run tauri build` → `Coruro.app` + `Coruro_0.1.0_aarch64.dmg`.
- Merged `feat/navbar-consolidate-new-icon` into `main` (fast-forward).

**Next Steps:**
- Push `main` to remote when ready.
- Verify new dock icon from installed release build.
- Optional: code-split large JS chunk (>500 kB warning).
