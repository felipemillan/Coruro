// Keychain-backed GitHub PAT storage.
// The raw token NEVER touches the JSON state file; it lives only in the
// macOS Keychain via the `keyring` crate.
//
// Service: "repo_dashboard"  ·  Account: "github_pat"

use keyring::{Entry, Error as KeyringError};
use std::process::Command;
use std::time::Duration;

const KEYRING_SERVICE: &str = "repo_dashboard";
const KEYRING_USER: &str = "github_pat";

/// Build the Keychain entry handle for the GitHub PAT slot.
fn token_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Failed to open Keychain entry: {e}"))
}

/// Persist the GitHub Personal Access Token to the macOS Keychain.
/// Returns `Err(String)` with a human-readable message on failure.
#[tauri::command]
pub fn store_token(token: String) -> Result<(), String> {
    let entry = token_entry()?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store token in Keychain: {e}"))
}

/// Read the GitHub Personal Access Token from the macOS Keychain.
/// Returns `Ok(None)` when no token has been stored, `Ok(Some(token))`
/// when present, or `Err(String)` on a Keychain access failure.
#[tauri::command]
pub fn get_token() -> Result<Option<String>, String> {
    let entry = token_entry()?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read token from Keychain: {e}")),
    }
}

/// Open `path` in the user's editor.
///
/// Strategy (matches the Settings UI):
///   1. Try the CLI binary `command` (e.g. "code"/"cursor"/"antigravity"):
///      `<command> <path>`. spawn() failing (binary not on the GUI app's PATH)
///      falls through to step 2.
///   2. Fall back to the macOS launcher: `open -a <app> <path>` — works for any
///      installed GUI editor without needing a CLI on PATH.
///
/// Args are passed as an array (never a shell string), so a `path` is never
/// interpreted as a shell command. `command`/`app` come from local Settings.
#[tauri::command]
pub fn open_in_editor(command: String, app: String, path: String) -> Result<(), String> {
    // Step 1: CLI binary. spawn() Ok means the process launched.
    let cli = command.trim();
    if !cli.is_empty() && Command::new(cli).arg(&path).spawn().is_ok() {
        return Ok(());
    }

    // Step 2: macOS `open -a <App>`. status() surfaces a wrong/missing app name.
    let app_name = app.trim();
    if app_name.is_empty() {
        return Err(format!(
            "Could not launch editor: CLI '{command}' failed and no fallback app name is set."
        ));
    }
    match Command::new("open").args(["-a", app_name, &path]).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "`open -a \"{app_name}\"` failed (exit {:?}). Is the app installed and the name exact?",
            status.code()
        )),
        Err(e) => Err(format!("Failed to run `open -a \"{app_name}\"`: {e}")),
    }
}

/// Open `path` in the user's terminal app via `open -a <app> <path>`.
///
/// macOS `open -a Terminal <dir>` opens a new terminal window rooted at the
/// directory (Terminal/iTerm/Ghostty all honour this). Distinct from
/// `open_in_editor`: no CLI step, just the GUI launcher. `app` comes from
/// local Settings (default "Terminal"). Args are an array — `path` is never
/// shell-interpreted.
#[tauri::command]
pub fn open_in_terminal(app: String, path: String) -> Result<(), String> {
    let app_name = app.trim();
    if app_name.is_empty() {
        return Err("No terminal app name is set (Settings → Terminal).".to_string());
    }
    match Command::new("open").args(["-a", app_name, &path]).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "`open -a \"{app_name}\"` failed (exit {:?}). Is the terminal installed and the name exact?",
            status.code()
        )),
        Err(e) => Err(format!("Failed to run `open -a \"{app_name}\"`: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Read-only git inspection (Phase 3). All ops use `git -C <path>` with arg
// arrays — never a shell string. None of these mutate the working tree.
// ---------------------------------------------------------------------------

/// Commits the local branch is ahead/behind its upstream.
///
/// Runs `git -C <path> rev-list --left-right --count @{u}...HEAD`, whose output
/// is "<behind>\t<ahead>" (left = upstream-only commits = behind; right =
/// HEAD-only commits = ahead). Returns `Ok(None)` when there is no upstream
/// configured (the command exits non-zero) so the UI can simply show nothing.
#[tauri::command]
pub async fn git_ahead_behind(path: String) -> Result<Option<(i64, i64)>, String> {
    // Async + spawn_blocking: the git subprocess runs on a blocking-pool thread
    // so the N-repo board fan-out never saturates Tauri's command executor.
    tokio::task::spawn_blocking(move || ahead_behind_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Blocking core of `git_ahead_behind` (synchronous; unit-testable directly).
fn ahead_behind_blocking(path: &str) -> Result<Option<(i64, i64)>, String> {
    let out = Command::new("git")
        .args([
            "-C",
            path,
            "rev-list",
            "--left-right",
            "--count",
            "@{u}...HEAD",
        ])
        .output()
        .map_err(|e| format!("Failed to run git rev-list: {e}"))?;
    // Non-zero exit almost always means "no upstream" — treat as None, not error.
    if !out.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.split_whitespace();
    let behind = parts.next().and_then(|s| s.parse::<i64>().ok());
    let ahead = parts.next().and_then(|s| s.parse::<i64>().ok());
    match (ahead, behind) {
        (Some(a), Some(b)) => Ok(Some((a, b))),
        _ => Ok(None),
    }
}

/// List local branch names (`git -C <path> branch --format=%(refname:short)`).
#[tauri::command]
pub async fn git_branches(path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || branches_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Blocking core of `git_branches`.
fn branches_blocking(path: &str) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .args(["-C", path, "branch", "--format=%(refname:short)"])
        .output()
        .map_err(|e| format!("Failed to run git branch: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git branch failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let branches = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(branches)
}

/// Fetch remote refs (`git -C <path> fetch`). This is the SOLE git_* command
/// permitted to touch the network (Coruro invariant #4): it updates
/// remote-tracking refs / FETCH_HEAD only — never the working tree or HEAD.
/// The boundary is locked by `git_boundary_tests` below.
#[tauri::command]
pub async fn git_fetch(path: String) -> Result<(), String> {
    // Network op — spawn_blocking keeps it off the command executor entirely
    // (it can take seconds on a slow remote).
    tokio::task::spawn_blocking(move || fetch_blocking(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// Blocking core of `git_fetch` — the SOLE git_* command that touches the network.
fn fetch_blocking(path: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", path, "fetch"])
        .output()
        .map_err(|e| format!("Failed to run git fetch: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "git fetch failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// Local-only repo stats for cards without GitHub enrichment.
///
/// Returns total commit count on HEAD, the last commit time (ISO 8601), and
/// the number of local branches. Any field that cannot be computed (e.g. an
/// empty repo with no commits) is returned as 0 / null rather than erroring,
/// so a single odd repo never breaks the scan.
#[tauri::command]
pub async fn git_local_stats(path: String) -> Result<(i64, Option<String>, i64), String> {
    // The three git sub-queries are independent, so run them on three
    // blocking-pool threads concurrently (tokio::join!) instead of serially.
    // Per call this turns 3 sequential fork+exec waits into ~1, and the whole
    // command is off the Tauri executor so an N-repo board fan-out can't stall it.
    let (p1, p2, p3) = (path.clone(), path.clone(), path);
    // spawn_blocking dispatches immediately, so all three are already running on
    // the pool before the first .await — awaiting in sequence still overlaps them.
    let commit_count = tokio::task::spawn_blocking(move || count_commits_blocking(&p1));
    let last_commit_at = tokio::task::spawn_blocking(move || last_commit_at_blocking(&p2));
    let branch_count = tokio::task::spawn_blocking(move || branch_count_blocking(&p3));
    Ok((
        commit_count.await.map_err(|e| e.to_string())?,
        last_commit_at.await.map_err(|e| e.to_string())?,
        branch_count.await.map_err(|e| e.to_string())?,
    ))
}

/// Commit count on HEAD. Empty repo → rev-list fails → 0.
fn count_commits_blocking(path: &str) -> i64 {
    Command::new("git")
        .args(["-C", path, "rev-list", "--count", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<i64>()
                .ok()
        })
        .unwrap_or(0)
}

/// Last commit time, strict ISO 8601. None on empty repo.
fn last_commit_at_blocking(path: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", path, "log", "-1", "--format=%cI"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Local branch count.
fn branch_count_blocking(path: &str) -> i64 {
    Command::new("git")
        .args(["-C", path, "branch", "--format=%(refname:short)"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count() as i64
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod local_stats_tests {
    use super::*;

    #[test]
    fn reports_stats_for_this_repo() {
        // The crate lives inside the project's own git repo. Test the blocking
        // cores directly (the command wrapper just runs these on the pool).
        let dir = env!("CARGO_MANIFEST_DIR");
        let commits = count_commits_blocking(dir);
        let last = last_commit_at_blocking(dir);
        let branches = branch_count_blocking(dir);
        assert!(commits >= 1, "expected at least one commit, got {commits}");
        assert!(last.is_some(), "expected a last-commit timestamp");
        assert!(
            branches >= 1,
            "expected at least one branch, got {branches}"
        );
    }
}

/// Last N commit subject lines (`git -C <path> log -n <n> --format=%s`).
/// Returns an empty vec on any failure so a single odd repo never breaks scan.
#[tauri::command]
pub async fn git_recent_commits(path: String, count: u32) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || recent_commits_blocking(&path, count))
        .await
        .map_err(|e| e.to_string())
}

/// Blocking core of `git_recent_commits`.
fn recent_commits_blocking(path: &str, count: u32) -> Vec<String> {
    let out = Command::new("git")
        .args(["-C", path, "log", "-n", &count.to_string(), "--format=%s"])
        .output();
    out.ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.to_string())
                .filter(|l| !l.trim().is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod recent_commits_tests {
    use super::*;
    #[test]
    fn lists_subjects_for_this_repo() {
        let subjects = recent_commits_blocking(env!("CARGO_MANIFEST_DIR"), 5);
        assert!(!subjects.is_empty(), "expected at least one commit subject");
    }
}

/// Request shape mirrors src/types.ts AiContext (serde camelCase).
/// `Serialize` lets `ai_analyze` derive the wire payload from this single struct
/// instead of a hand-maintained `json!` literal — the camelCase mapping lives in
/// exactly one place. Round-trip-tested by `ai_context_serde_tests`.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContext {
    repo_name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default)]
    recent_commits: Vec<String>,
    #[serde(default)]
    top_entries: Vec<String>,
    #[serde(default)]
    readme: Option<String>,
}

/// Spawn the coruro-ai sidecar, pipe the context JSON to stdin, and return
/// the sidecar's JSON line verbatim (a string the JS layer parses into AiResult).
/// On spawn/timeout failure returns a synthetic error JSON so the caller always
/// gets a well-formed AiResult.
/// Locate the bundled `coruro-ai` sidecar next to the main executable.
/// Tauri's `shell().sidecar()` path resolution proved unreliable in the
/// release bundle (spawned with ENOENT even with the binary present in
/// `Contents/MacOS/`), so we resolve the absolute path ourselves from
/// `current_exe()` and spawn it directly. Both the stripped name and the
/// target-triple-suffixed name are checked.
fn resolve_sidecar() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["coruro-ai", "coruro-ai-aarch64-apple-darwin"] {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Blocking spawn of the sidecar: write the JSON payload to stdin, close it
/// (the Swift side reads one line), and read the JSON response from stdout.
fn run_sidecar(bin: &std::path::Path, payload: &[u8]) -> std::io::Result<String> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};

    let mut child = Command::new(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    // Write payload then drop stdin so the child sees EOF.
    child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("no stdin"))?
        .write_all(payload)?;
    let mut out = String::new();
    if let Some(mut so) = child.stdout.take() {
        so.read_to_string(&mut out)?;
    }
    let _ = child.wait();
    Ok(out)
}

/// Serialize a request body to a newline-terminated JSON payload for the sidecar
/// (the Swift side reads exactly one line).
fn encode_payload(value: serde_json::Value) -> Result<Vec<u8>, String> {
    let mut payload = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    payload.push(b'\n');
    Ok(payload)
}

/// Run the sidecar with a prepared `payload` under `timeout_secs`, returning its
/// JSON line verbatim. Every missing-binary / spawn / join / timeout failure is
/// mapped to a well-formed synthetic error JSON so the caller always receives a
/// parseable AiResult-shaped string (never `Err`). This is the single owner of
/// the spawn + timeout + error-classification policy shared by all `ai_*`
/// commands.
async fn run_sidecar_mode(payload: Vec<u8>, timeout_secs: u64) -> String {
    let bin = match resolve_sidecar() {
        Some(p) => p,
        None => {
            eprintln!("[ai] sidecar binary not found next to current_exe");
            return r#"{"ok":false,"error":"sidecar_missing"}"#.to_string();
        }
    };

    let work = tokio::task::spawn_blocking(move || run_sidecar(&bin, &payload));
    match tokio::time::timeout(Duration::from_secs(timeout_secs), work).await {
        Ok(Ok(Ok(out))) if !out.trim().is_empty() => out.trim().to_string(),
        Ok(Ok(Ok(_))) => r#"{"ok":false,"error":"generation","reason":"empty output"}"#.to_string(),
        Ok(Ok(Err(e))) => {
            eprintln!("[ai] sidecar spawn err: {e}");
            r#"{"ok":false,"error":"sidecar_missing"}"#.to_string()
        }
        Ok(Err(e)) => {
            eprintln!("[ai] join err: {e}");
            r#"{"ok":false,"error":"generation"}"#.to_string()
        }
        Err(_) => r#"{"ok":false,"error":"timeout"}"#.to_string(),
    }
}

/// Commit subject lines since a given ISO 8601 timestamp.
/// `git -C <path> log --since=<iso> --format=%s`
/// Returns an empty vec on failure; never errors.
#[tauri::command]
pub async fn git_commits_since(path: String, since_iso: String) -> Result<Vec<String>, String> {
    let output = std::process::Command::new("git")
        .args([
            "-C",
            &path,
            "log",
            &format!("--since={}", since_iso),
            "--format=%s",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    Ok(commits)
}

/// File-level detail for a single commit.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub sha: String,
    pub subject: String,
    pub files: Vec<String>,
    pub folders: Vec<String>,
    pub added: i64,
    pub deleted: i64,
}

/// Commit subjects + numstat since a given ISO timestamp.
/// git log --branches --since=<iso> --format="COMMIT:%H %s" --numstat
/// --branches covers only local branches (excludes refs/remotes/* and stash),
/// avoiding attribution of teammates' commits to the local user.
/// SHA dedup in the store handles any overlap between local branches.
/// Returns CommitDetail per commit; empty vec on failure.
#[tauri::command]
pub async fn git_commits_since_numstat(
    path: String,
    since_iso: String,
) -> Result<Vec<CommitDetail>, String> {
    let output = std::process::Command::new("git")
        .args([
            "-C",
            &path,
            "log",
            "--branches",
            &format!("--since={}", since_iso),
            "--format=COMMIT:%H %s",
            "--numstat",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits: Vec<CommitDetail> = Vec::new();
    let mut current: Option<CommitDetail> = None;

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("COMMIT:") {
            if let Some(c) = current.take() {
                commits.push(c);
            }
            let mut parts = rest.splitn(2, ' ');
            let sha = parts.next().unwrap_or("").to_string();
            let subject = parts.next().unwrap_or("").to_string();
            current = Some(CommitDetail {
                sha,
                subject,
                files: vec![],
                folders: vec![],
                added: 0,
                deleted: 0,
            });
        } else if let Some(c) = current.as_mut() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() == 3 {
                let added: i64 = cols[0].parse().unwrap_or(0);
                let deleted: i64 = cols[1].parse().unwrap_or(0);
                let file = cols[2].to_string();
                let folder = file.split('/').next().unwrap_or(&file).to_string();
                c.added += added;
                c.deleted += deleted;
                if !c.files.contains(&file) {
                    c.files.push(file);
                }
                if !c.folders.contains(&folder) {
                    c.folders.push(folder);
                }
            }
        }
    }
    if let Some(c) = current {
        commits.push(c);
    }
    Ok(commits)
}

/// Spawn the coruro-ai sidecar in "enrich" mode.
/// Writes {"mode":"enrich","items":<items>} to stdin, returns one JSON line.
/// On any spawn / sidecar-missing / timeout error returns a synthetic error JSON
/// with the same envelope shapes used by ai_day_notes so the frontend parser
/// can reuse the same error-handling path.
#[tauri::command]
pub async fn ai_enrich(items: serde_json::Value) -> Result<String, String> {
    let payload = encode_payload(serde_json::json!({ "mode": "enrich", "items": items }))?;
    Ok(run_sidecar_mode(payload, 45).await)
}

/// Uncommitted-work summary for a repo.
/// git diff --stat HEAD -> last line if it is the "N files changed..." summary,
/// plus git status --porcelain -> count of "??" (untracked) lines.
/// Returns "<summary>", "<summary>, N untracked", "N untracked", or "" (clean).
/// Never errors on git failure — returns Ok("").
#[tauri::command]
pub async fn git_dirty_stat(path: String) -> Result<String, String> {
    // Was: two blocking std::process calls running serially on a Tokio async
    // thread. Now each runs on the blocking pool and they overlap (join!), so
    // the per-repo cost halves and the async executor thread isn't held hostage.
    let (p1, p2) = (path.clone(), path);
    let summary_task = tokio::task::spawn_blocking(move || {
        std::process::Command::new("git")
            .args(["-C", &p1, "diff", "--stat", "HEAD"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .and_then(|stdout| {
                stdout
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .next_back()
                    .filter(|l| l.contains("changed"))
                    .map(|l| l.trim().to_string())
            })
            .unwrap_or_default()
    });
    let untracked_task = tokio::task::spawn_blocking(move || {
        std::process::Command::new("git")
            .args(["-C", &p2, "status", "--porcelain"])
            .output()
            .ok()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .filter(|l| l.starts_with("??"))
                    .count()
            })
            .unwrap_or(0)
    });
    // Both tasks are already running on the pool (spawned above); awaiting in
    // sequence still overlaps them.
    let summary = summary_task.await.map_err(|e| e.to_string())?;
    let untracked = untracked_task.await.map_err(|e| e.to_string())?;

    let result = match (summary.is_empty(), untracked) {
        (true, 0) => String::new(),
        (true, n) => format!("{} untracked", n),
        (false, 0) => summary,
        (false, n) => format!("{}, {} untracked", summary, n),
    };
    Ok(result)
}

/// Spawn the coruro-ai sidecar in "day_notes" mode.
///
/// Writes a JSON payload to stdin; returns one JSON line (`DayNotesResponse`).
/// On any spawn / sidecar-missing error returns a synthetic error JSON.
///
/// # Payload contract (WI-3.1 freeze)
///
/// Required fields:
/// - `mode`  — `"day_notes"` (string discriminator)
/// - `repos` — array of `{ name, commits }` repo entries (metadata-only; no paths/secrets)
///
/// Optional field (Phase 3 / WI-3.2+):
/// - `priorContext` — `[String]`, camelCase.
///   Absent (not null) when there are no prior notes to send; the Swift side
///   defaults a missing key to `[]` so legacy payloads without this field
///   continue to decode cleanly (back-compat invariant).
///
///   Each string is a sanitized exec-summary sentence produced by
///   `sanitizeExecSummary` on the TypeScript side. Strings MUST NOT contain:
///   raw commit subjects, file paths, tokens, app-event labels, numeric stats,
///   or repo references. The sanitizer is the authoritative gate — no raw
///   content may bypass it.
///
/// # P0 invariants (never bypass)
/// - Zero-network AI: `ai_day_notes` is NOT called for app-only or single-repo
///   sessions; those compose the note deterministically in TypeScript.
/// - `priorContext` byte count is added to the context-budget line BEFORE
///   `exceedsContextBudget` runs in the sidecar — the guard is never bypassed.
/// - `DayNotesRequest` / `DayNotesResponse` wire shape is back-compatible:
///   payloads without `priorContext` decode to `priorContext = []` on the Swift
///   side via the default initializer.
#[tauri::command]
pub async fn ai_day_notes(repos: serde_json::Value) -> Result<String, String> {
    let payload = encode_payload(serde_json::json!({ "mode": "day_notes", "repos": repos }))?;
    Ok(run_sidecar_mode(payload, 60).await)
}

/// Spawn the coruro-ai sidecar in "curate" mode for the Setup Curator.
/// Writes {"mode":"curate","findings":<findings>,"summary":<summary>} to stdin,
/// returns one JSON line. Findings are computed deterministically in TS and
/// passed through verbatim; the sidecar only narrates qualitatively and must
/// never recompute or repeat numbers. On any spawn / sidecar-missing / timeout
/// error returns synthetic error JSON (never Err) so findings still render
/// without the AI narrative.
#[tauri::command]
pub async fn ai_curate(
    findings: serde_json::Value,
    summary: serde_json::Value,
) -> Result<String, String> {
    let payload = encode_payload(serde_json::json!({
        "mode": "curate",
        "findings": findings,
        "summary": summary,
    }))?;

    // 90s: the curator narrates the whole scanned inventory (largest of the
    // sidecar prompts) on the on-device model. Generous ceiling, but the AI
    // output is additive — findings already rendered — so it never blocks the UI.
    Ok(run_sidecar_mode(payload, 90).await)
}

#[tauri::command]
pub async fn ai_analyze(_app: tauri::AppHandle, context: AiContext) -> Result<String, String> {
    // Derive the wire object from the struct (single camelCase mapping), then
    // inject the mode discriminator. No hand-replicated field list.
    let mut value = serde_json::to_value(&context).map_err(|e| e.to_string())?;
    value["mode"] = serde_json::Value::String("analyze".to_string());
    let payload = encode_payload(value)?;
    Ok(run_sidecar_mode(payload, 30).await)
}

// ---------------------------------------------------------------------------
// Repo type detection (WC-1)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDetection {
    pub repo_type: String, // "Tauri" | "NextJs" | "NodeJs" | "Cargo" | "Make" | "Unknown"
    pub label: String,     // display string, e.g. "npm run tauri dev"
}

/// Inspect a local directory and return the project type + recommended run command.
/// Detection is purely filesystem-based — no shell execution.
#[tauri::command]
pub fn detect_repo_type(path: String) -> Result<RepoDetection, String> {
    use std::path::Path;

    let base = Path::new(&path);

    // 1. Tauri: src-tauri/ subdir OR tauri.conf.json at root.
    if base.join("src-tauri").exists() || base.join("tauri.conf.json").exists() {
        return Ok(RepoDetection {
            repo_type: "Tauri".to_string(),
            label: "npm run tauri dev".to_string(),
        });
    }

    // 2 & 3. package.json present — check for Next.js.
    let pkg_path = base.join("package.json");
    if pkg_path.exists() {
        let has_next = std::fs::read_to_string(&pkg_path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .map(|json| {
                let in_deps = json
                    .get("dependencies")
                    .and_then(|d| d.as_object())
                    .map(|m| m.contains_key("next"))
                    .unwrap_or(false);
                let in_dev = json
                    .get("devDependencies")
                    .and_then(|d| d.as_object())
                    .map(|m| m.contains_key("next"))
                    .unwrap_or(false);
                in_deps || in_dev
            })
            .unwrap_or(false);

        if has_next {
            return Ok(RepoDetection {
                repo_type: "NextJs".to_string(),
                label: "npm run dev".to_string(),
            });
        }

        // Plain Node — use "dev" script if present, else "start".
        let has_dev_script = std::fs::read_to_string(&pkg_path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|json| {
                json.get("scripts")
                    .and_then(|s| s.as_object())
                    .map(|m| m.contains_key("dev"))
            })
            .unwrap_or(false);

        let label = if has_dev_script {
            "npm run dev".to_string()
        } else {
            "npm start".to_string()
        };
        return Ok(RepoDetection {
            repo_type: "NodeJs".to_string(),
            label,
        });
    }

    // 4. Cargo (and no src-tauri/ — already excluded above).
    if base.join("Cargo.toml").exists() {
        return Ok(RepoDetection {
            repo_type: "Cargo".to_string(),
            label: "cargo run".to_string(),
        });
    }

    // 5. Make.
    if base.join("Makefile").exists() {
        return Ok(RepoDetection {
            repo_type: "Make".to_string(),
            label: "make".to_string(),
        });
    }

    // 6. Unknown.
    Ok(RepoDetection {
        repo_type: "Unknown".to_string(),
        label: String::new(),
    })
}

#[cfg(test)]
mod git_boundary_tests {
    //! Locks Coruro invariant #4: git operations are read-only on the user's
    //! repos. `git_fetch` is the SOLE git_* command allowed to touch the network
    //! (it updates remote-tracking refs / FETCH_HEAD only, never the working tree
    //! or HEAD); every other git_* command uses a read-only verb.
    //!
    //! These tests scan this file's own source, so adding a network-reaching or
    //! working-tree-mutating git verb fails CI unless the contract is updated
    //! deliberately.

    /// Documented contract: (command, git subcommand(s), reaches_network).
    /// The networked entry's verb is spelled descriptively so it does not collide
    /// with the quoted fetch arg the source-scan tests count.
    const GIT_CONTRACT: &[(&str, &str, bool)] = &[
        ("git_ahead_behind", "rev-list", false),
        ("git_branches", "branch", false),
        ("git_fetch", "fetch (remote refs)", true),
        ("git_local_stats", "rev-list/log/branch", false),
        ("git_recent_commits", "log", false),
        ("git_commits_since", "log", false),
        ("git_commits_since_numstat", "log", false),
        ("git_dirty_stat", "diff/ls-files", false),
    ];

    #[test]
    fn contract_lists_exactly_one_networked_command() {
        let networked: Vec<&str> = GIT_CONTRACT
            .iter()
            .filter(|(_, _, net)| *net)
            .map(|(cmd, _, _)| *cmd)
            .collect();
        assert_eq!(networked, vec!["git_fetch"]);
    }

    #[test]
    fn source_contains_no_mutating_or_extra_network_git_verbs() {
        let src = include_str!("commands.rs");
        // Quoted forms only appear as actual `Command::args([...])` arguments;
        // prose and comments use the unquoted word, so this never false-positives.
        let forbidden = [
            "\"push\"",
            "\"pull\"",
            "\"clone\"",
            "\"commit\"",
            "\"merge\"",
            "\"rebase\"",
            "\"reset\"",
            "\"checkout\"",
            "\"cherry-pick\"",
            "\"stash\"",
        ];
        for verb in forbidden {
            assert!(
                !src.contains(verb),
                "git invariant #4 violated: forbidden git verb {verb} found in commands.rs"
            );
        }
    }

    #[test]
    fn fetch_is_the_only_networked_git_verb_in_source() {
        let src = include_str!("commands.rs");
        let needle = ['"', 'f', 'e', 't', 'c', 'h', '"']
            .iter()
            .collect::<String>();
        let fetch_args = src.matches(&needle).count();
        assert_eq!(
            fetch_args, 1,
            "expected exactly one quoted fetch git arg (git_fetch); found {fetch_args}"
        );
    }
}

#[cfg(test)]
mod ai_context_serde_tests {
    use super::*;

    /// The single camelCase mapping (struct derive) must round-trip both ways so
    /// `ai_analyze`'s `to_value(&context)` produces exactly the keys the sidecar
    /// and src/types.ts expect — no snake_case leak, no hand-maintained literal.
    #[test]
    fn ai_context_round_trips_to_camelcase() {
        let json = r#"{"repoName":"coruro","description":"d","languages":["Rust"],"recentCommits":["c1"],"topEntries":["src"],"readme":"r"}"#;
        let ctx: AiContext = serde_json::from_str(json).expect("deserialize AiContext");
        let value = serde_json::to_value(&ctx).expect("serialize AiContext");

        assert_eq!(value["repoName"], "coruro");
        assert_eq!(value["recentCommits"][0], "c1");
        assert_eq!(value["topEntries"][0], "src");
        assert_eq!(value["readme"], "r");
        // No snake_case keys may leak onto the wire.
        assert!(value.get("repo_name").is_none());
        assert!(value.get("recent_commits").is_none());
        assert!(value.get("top_entries").is_none());
    }

    #[test]
    fn encode_payload_is_newline_terminated_valid_json() {
        let bytes = encode_payload(serde_json::json!({ "mode": "enrich", "items": [] }))
            .expect("encode payload");
        assert_eq!(*bytes.last().unwrap(), b'\n');
        let parsed: serde_json::Value =
            serde_json::from_slice(&bytes[..bytes.len() - 1]).expect("payload is valid JSON");
        assert_eq!(parsed["mode"], "enrich");
    }
}
