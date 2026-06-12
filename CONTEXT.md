# Context

**Current Task:** Day notes v2 shipped — tiered session report (deterministic TS skeleton + AI exec summary), user-written notes, markdown editor with @mentions.

**Key Decisions:**
- Report structure/stats computed in `sessionReport.ts`; Apple Intelligence gets number-free digest (model parrots/miscomputes digits).
- Sidecar deploys to `src-tauri/binaries/coruro-ai-aarch64-apple-darwin` — externalBin overwrites target/debug on every cargo rebuild.
- AI failure degrades to stats-only note (`model: local-stats`), never blocks generation.

**Next Steps:**
- On-device test of full report format in app UI.
- Remaining minor review findings: mentions in mixed/bold markdown lines, 403 rate-limit detection.
