// Keychain-backed GitHub PAT storage.
// The raw token NEVER touches the JSON state file; it lives only in the
// macOS Keychain via the `keyring` crate.
//
// Service: "repo_dashboard"  ·  Account: "github_pat"

use keyring::{Entry, Error as KeyringError};
use std::process::Command;

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
