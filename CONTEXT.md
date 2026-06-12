# Context

**Current Task:** Notes tab feature fully implemented and shipped to main.

**Key Decisions:**
- `generateDayNotes` fixed: field mismatch `recentCommits`→`commits` was silent failure; now also pulls GitHub API (commits + PRs) per repo.
- Error surface added: `notesError` shows red banner in NotesTab instead of silent console.warn.
- Beverly gate: generatingNotes/notesError runtime-only (not persisted), cap 90, no secrets in AI payload.

**Next Steps:**
- Test on-device with Apple Intelligence active (sidecar day_notes mode).
- Consider adding notes clear/delete UI.
