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
