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
    if !cli.is_empty() {
        if Command::new(cli).arg(&path).spawn().is_ok() {
            return Ok(());
        }
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
pub fn git_ahead_behind(path: String) -> Result<Option<(i64, i64)>, String> {
    let out = Command::new("git")
        .args(["-C", &path, "rev-list", "--left-right", "--count", "@{u}...HEAD"])
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
pub fn git_branches(path: String) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .args(["-C", &path, "branch", "--format=%(refname:short)"])
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

/// Fetch remote refs (`git -C <path> fetch`). Read-only w.r.t. the working tree
/// (updates remote-tracking refs only); never changes checked-out files.
#[tauri::command]
pub fn git_fetch(path: String) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", &path, "fetch"])
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
pub fn git_local_stats(path: String) -> Result<(i64, Option<String>, i64), String> {
    // Commit count on HEAD. Empty repo → rev-list fails → 0.
    let commit_count = Command::new("git")
        .args(["-C", &path, "rev-list", "--count", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<i64>().ok())
        .unwrap_or(0);

    // Last commit time, strict ISO 8601. None on empty repo.
    let last_commit_at = Command::new("git")
        .args(["-C", &path, "log", "-1", "--format=%cI"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    // Local branch count.
    let branch_count = Command::new("git")
        .args(["-C", &path, "branch", "--format=%(refname:short)"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count() as i64
        })
        .unwrap_or(0);

    Ok((commit_count, last_commit_at, branch_count))
}

#[cfg(test)]
mod local_stats_tests {
    use super::*;

    #[test]
    fn reports_stats_for_this_repo() {
        // The crate lives inside the project's own git repo.
        let (commits, last, branches) = git_local_stats(env!("CARGO_MANIFEST_DIR").to_string())
            .expect("git_local_stats should succeed in a repo");
        assert!(commits >= 1, "expected at least one commit, got {commits}");
        assert!(last.is_some(), "expected a last-commit timestamp");
        assert!(branches >= 1, "expected at least one branch, got {branches}");
    }
}

/// Last N commit subject lines (`git -C <path> log -n <n> --format=%s`).
/// Returns an empty vec on any failure so a single odd repo never breaks scan.
#[tauri::command]
pub fn git_recent_commits(path: String, count: u32) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .args(["-C", &path, "log", "-n", &count.to_string(), "--format=%s"])
        .output();
    let subjects = out
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.to_string())
                .filter(|l| !l.trim().is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    Ok(subjects)
}

#[cfg(test)]
mod recent_commits_tests {
    use super::*;
    #[test]
    fn lists_subjects_for_this_repo() {
        let subjects = git_recent_commits(env!("CARGO_MANIFEST_DIR").to_string(), 5).unwrap();
        assert!(!subjects.is_empty(), "expected at least one commit subject");
    }
}

/// Request shape mirrors src/types.ts AiContext (serde camelCase).
#[derive(serde::Deserialize)]
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

/// Commit subject lines since a given ISO 8601 timestamp.
/// `git -C <path> log --since=<iso> --format=%s`
/// Returns an empty vec on failure; never errors.
#[tauri::command]
pub async fn git_commits_since(path: String, since_iso: String) -> Result<Vec<String>, String> {
    let output = std::process::Command::new("git")
        .args(["-C", &path, "log", &format!("--since={}", since_iso), "--format=%s"])
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
pub async fn git_commits_since_numstat(path: String, since_iso: String) -> Result<Vec<CommitDetail>, String> {
    let output = std::process::Command::new("git")
        .args(["-C", &path, "log", "--branches",
               &format!("--since={}", since_iso),
               "--format=COMMIT:%H %s",
               "--numstat"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits: Vec<CommitDetail> = Vec::new();
    let mut current: Option<CommitDetail> = None;

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("COMMIT:") {
            if let Some(c) = current.take() { commits.push(c); }
            let mut parts = rest.splitn(2, ' ');
            let sha = parts.next().unwrap_or("").to_string();
            let subject = parts.next().unwrap_or("").to_string();
            current = Some(CommitDetail { sha, subject, files: vec![], folders: vec![], added: 0, deleted: 0 });
        } else if let Some(c) = current.as_mut() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() == 3 {
                let added: i64 = cols[0].parse().unwrap_or(0);
                let deleted: i64 = cols[1].parse().unwrap_or(0);
                let file = cols[2].to_string();
                let folder = file.split('/').next().unwrap_or(&file).to_string();
                c.added += added;
                c.deleted += deleted;
                if !c.files.contains(&file) { c.files.push(file); }
                if !c.folders.contains(&folder) { c.folders.push(folder); }
            }
        }
    }
    if let Some(c) = current { commits.push(c); }
    Ok(commits)
}

/// Spawn the coruro-ai sidecar in "enrich" mode.
/// Writes {"mode":"enrich","items":<items>} to stdin, returns one JSON line.
/// On any spawn / sidecar-missing / timeout error returns a synthetic error JSON
/// with the same envelope shapes used by ai_day_notes so the frontend parser
/// can reuse the same error-handling path.
#[tauri::command]
pub async fn ai_enrich(items: serde_json::Value) -> Result<String, String> {
    let mut payload = serde_json::to_vec(&serde_json::json!({
        "mode": "enrich",
        "items": items,
    }))
    .map_err(|e| e.to_string())?;
    payload.push(b'\n');

    let bin = match resolve_sidecar() {
        Some(p) => p,
        None => {
            eprintln!("[ai] sidecar binary not found next to current_exe");
            return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string());
        }
    };

    let work = tokio::task::spawn_blocking(move || run_sidecar(&bin, &payload));
    match tokio::time::timeout(Duration::from_secs(45), work).await {
        Ok(Ok(Ok(out))) if !out.trim().is_empty() => Ok(out.trim().to_string()),
        Ok(Ok(Ok(_))) => Ok(r#"{"ok":false,"error":"generation","reason":"empty output"}"#.to_string()),
        Ok(Ok(Err(e))) => {
            eprintln!("[ai] sidecar spawn err: {e}");
            Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string())
        }
        Ok(Err(e)) => {
            eprintln!("[ai] join err: {e}");
            Ok(r#"{"ok":false,"error":"generation"}"#.to_string())
        }
        Err(_) => Ok(r#"{"ok":false,"error":"timeout"}"#.to_string()),
    }
}

/// Uncommitted-work summary for a repo.
/// git diff --stat HEAD -> last line if it is the "N files changed..." summary,
/// plus git status --porcelain -> count of "??" (untracked) lines.
/// Returns "<summary>", "<summary>, N untracked", "N untracked", or "" (clean).
/// Never errors on git failure — returns Ok("").
#[tauri::command]
pub async fn git_dirty_stat(path: String) -> Result<String, String> {
    let summary = std::process::Command::new("git")
        .args(["-C", &path, "diff", "--stat", "HEAD"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .and_then(|stdout| {
            stdout
                .lines()
                .filter(|l| !l.trim().is_empty())
                .last()
                .filter(|l| l.contains("changed"))
                .map(|l| l.trim().to_string())
        })
        .unwrap_or_default();

    let untracked = std::process::Command::new("git")
        .args(["-C", &path, "status", "--porcelain"])
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| l.starts_with("??"))
                .count()
        })
        .unwrap_or(0);

    let result = match (summary.is_empty(), untracked) {
        (true, 0) => String::new(),
        (true, n) => format!("{} untracked", n),
        (false, 0) => summary,
        (false, n) => format!("{}, {} untracked", summary, n),
    };
    Ok(result)
}

/// Spawn the coruro-ai sidecar in "day_notes" mode.
/// Writes {"mode":"day_notes","repos":<repos>} to stdin, returns one JSON line.
/// On any spawn / sidecar-missing error returns a synthetic error JSON.
#[tauri::command]
pub async fn ai_day_notes(repos: serde_json::Value) -> Result<String, String> {
    let mut payload = serde_json::to_vec(&serde_json::json!({
        "mode": "day_notes",
        "repos": repos,
    }))
    .map_err(|e| e.to_string())?;
    payload.push(b'\n');

    let bin = match resolve_sidecar() {
        Some(p) => p,
        None => {
            eprintln!("[ai] sidecar binary not found next to current_exe");
            return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string());
        }
    };

    let work = tokio::task::spawn_blocking(move || run_sidecar(&bin, &payload));
    match tokio::time::timeout(Duration::from_secs(60), work).await {
        Ok(Ok(Ok(out))) if !out.trim().is_empty() => Ok(out.trim().to_string()),
        Ok(Ok(Ok(_))) => Ok(r#"{"ok":false,"error":"generation","reason":"empty output"}"#.to_string()),
        Ok(Ok(Err(e))) => {
            eprintln!("[ai] sidecar spawn err: {e}");
            Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string())
        }
        Ok(Err(e)) => {
            eprintln!("[ai] join err: {e}");
            Ok(r#"{"ok":false,"error":"generation"}"#.to_string())
        }
        Err(_) => Ok(r#"{"ok":false,"error":"timeout"}"#.to_string()),
    }
}

#[tauri::command]
pub async fn ai_analyze(_app: tauri::AppHandle, context: AiContext) -> Result<String, String> {
    let mut payload = serde_json::to_vec(&serde_json::json!({
        "mode": "analyze",
        "repoName": context.repo_name,
        "description": context.description,
        "languages": context.languages,
        "recentCommits": context.recent_commits,
        "topEntries": context.top_entries,
        "readme": context.readme,
    })).map_err(|e| e.to_string())?;
    payload.push(b'\n');

    let bin = match resolve_sidecar() {
        Some(p) => p,
        None => {
            eprintln!("[ai] sidecar binary not found next to current_exe");
            return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string());
        }
    };

    let work = tokio::task::spawn_blocking(move || run_sidecar(&bin, &payload));
    match tokio::time::timeout(Duration::from_secs(30), work).await {
        Ok(Ok(Ok(out))) if !out.trim().is_empty() => Ok(out.trim().to_string()),
        Ok(Ok(Ok(_))) => Ok(r#"{"ok":false,"error":"generation","reason":"empty output"}"#.to_string()),
        Ok(Ok(Err(e))) => {
            eprintln!("[ai] sidecar spawn err: {e}");
            Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string())
        }
        Ok(Err(e)) => {
            eprintln!("[ai] join err: {e}");
            Ok(r#"{"ok":false,"error":"generation"}"#.to_string())
        }
        Err(_) => Ok(r#"{"ok":false,"error":"timeout"}"#.to_string()),
    }
}
