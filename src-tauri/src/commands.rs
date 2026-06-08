// Keychain-backed GitHub PAT storage.
// The raw token NEVER touches the JSON state file; it lives only in the
// macOS Keychain via the `keyring` crate.
//
// Service: "repo_dashboard"  ·  Account: "github_pat"

use keyring::{Entry, Error as KeyringError};
use std::process::Command;
use std::time::Duration;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

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

/// Spawn the mygitdash-ai sidecar, pipe the context JSON to stdin, and return
/// the sidecar's JSON line verbatim (a string the JS layer parses into AiResult).
/// On spawn/timeout failure returns a synthetic error JSON so the caller always
/// gets a well-formed AiResult.
#[tauri::command]
pub async fn ai_analyze(app: tauri::AppHandle, context: AiContext) -> Result<String, String> {
    let payload = serde_json::to_vec(&serde_json::json!({
        "repoName": context.repo_name,
        "description": context.description,
        "languages": context.languages,
        "recentCommits": context.recent_commits,
        "topEntries": context.top_entries,
        "readme": context.readme,
    })).map_err(|e| e.to_string())?;

    let sidecar = match app.shell().sidecar("mygitdash-ai") {
        Ok(c) => c,
        Err(_) => return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string()),
    };
    let (mut rx, mut child) = match sidecar.spawn() {
        Ok(v) => v,
        Err(_) => return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string()),
    };
    if child.write(&payload).is_err() {
        return Ok(r#"{"ok":false,"error":"sidecar_missing"}"#.to_string());
    }
    let _ = child.write(b"\n");

    let mut acc = String::new();
    let collect = async {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(bytes) = event {
                acc.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
        acc
    };
    match tokio::time::timeout(Duration::from_secs(30), collect).await {
        Ok(out) if !out.trim().is_empty() => Ok(out.trim().to_string()),
        Ok(_) => Ok(r#"{"ok":false,"error":"generation","reason":"empty output"}"#.to_string()),
        Err(_) => Ok(r#"{"ok":false,"error":"timeout"}"#.to_string()),
    }
}
