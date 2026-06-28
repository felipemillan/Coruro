// publisher.rs — assisted-manual Publisher backend.
//
// Two read-only, network-free Tauri commands:
//   1. `publisher_generate` — generates a post draft HEADLESS via `claude -p`
//      over stdio. Text-only; no image rendering.
//   2. `publisher_open_compose` — opens the platform's compose page in the
//      user's REAL browser via the `opener` plugin. No automation, no cookies,
//      no headless login: the human pastes the copied draft and clicks post.
//
// P0 invariants enforced here:
//   - No git logic lives in this file.
//   - Publishing is assisted-manual: this file only OPENS a URL; it never logs
//     in, replays cookies, or auto-posts.

use std::io::Read;
use std::process::{Command, Stdio};

use tauri_plugin_opener::OpenerExt;

/// Graceful-degrade message reused when the `claude` CLI can't be spawned for
/// headless draft generation. A clear, actionable string instead of a panic or
/// an opaque OS error.
const CLAUDE_MISSING: &str =
    "claude CLI not found (install Claude Code: https://claude.com/claude-code)";

/// Blocking, injection-safe spawn of a HEADLESS `claude -p` content generation.
///
/// The prompt rides in the `CORURO_PROMPT` env var and is referenced as
/// `"$CORURO_PROMPT"` inside the script — it is NEVER interpolated into the
/// script string, exactly like `pty.rs::pty_spawn`. This is the only safe way to
/// pass arbitrary user/model text through a shell.
///
/// P0 invariants enforced here:
///   - cwd is a NEUTRAL directory (`std::env::temp_dir()`), NEVER any repo path.
///     This is the primary guarantee that generation cannot touch a working
///     tree: claude runs nowhere near a git checkout.
///   - Tools that could mutate the filesystem or reach the network are disabled
///     via `--disallowedTools` (Bash, Write, Edit, NotebookEdit, WebFetch,
///     WebSearch); no `--dangerously-skip-permissions` is passed.
///
/// Returns the raw stdout (a JSON object, `--output-format json`). A missing
/// `claude` binary surfaces as `ErrorKind::NotFound` and is mapped to
/// `CLAUDE_MISSING`.
fn run_claude_headless(prompt: &str) -> std::io::Result<String> {
    // Login shell resolves PATH (a Finder-launched bundle has no shell PATH);
    // the prompt rides in CORURO_PROMPT so no shell quoting of model/user input
    // is ever needed. Model pinned to Sonnet 4.6 — same plan-billed tier as the
    // interactive PTY path.
    let script = "exec claude --model=claude-sonnet-4-6 -p \"$CORURO_PROMPT\" \
         --output-format json \
         --disallowedTools \"Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch\"";

    let mut child = Command::new("/bin/zsh")
        .args(["-lc", script])
        .env("CORURO_PROMPT", prompt)
        // NEUTRAL cwd — never repo.path. Primary git-read-only guarantee.
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    // Close stdin so claude sees EOF and runs purely headless (no REPL input).
    drop(child.stdin.take());
    let mut out = String::new();
    if let Some(mut so) = child.stdout.take() {
        so.read_to_string(&mut out)?;
    }
    let _ = child.wait();
    Ok(out)
}

/// Generate a Publisher draft HEADLESS via `claude -p` and return the post body.
///
/// Same plan-billed `claude` path the interactive PTY uses — NOT the Apple
/// FoundationModels sidecar, so invariant 1 (AI is on-device) is unaffected by
/// this command (it neither adds nor removes a network path; `claude` is the
/// user's own already-authorized CLI). The neutral temp_dir cwd + disabled
/// mutation tools + absence of `--dangerously-skip-permissions` together hold
/// invariant 4 (git stays read-only): this command cannot mutate any working
/// tree.
///
/// Runs the blocking spawn inside `spawn_blocking` under a ~120s timeout, the
/// same async pattern as the `git_*` / sidecar commands. Parses the JSON object
/// claude emits, returning the `"result"` string. An `is_error` flag, an empty
/// result, or a spawn failure returns `Err` with an actionable message.
#[tauri::command]
pub async fn publisher_generate(prompt: String) -> Result<String, String> {
    let work = tauri::async_runtime::spawn_blocking(move || run_claude_headless(&prompt));

    let raw = match tokio::time::timeout(std::time::Duration::from_secs(120), work).await {
        Ok(Ok(Ok(out))) => out,
        Ok(Ok(Err(e))) => {
            // A missing `claude` binary surfaces as NotFound — actionable hint.
            if e.kind() == std::io::ErrorKind::NotFound {
                return Err(CLAUDE_MISSING.to_string());
            }
            return Err(format!("claude generation failed: {e}"));
        }
        Ok(Err(e)) => return Err(format!("claude generation join error: {e}")),
        Err(_) => return Err("claude generation timed out".to_string()),
    };

    let line = raw.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    if line.is_empty() {
        return Err(CLAUDE_MISSING.to_string());
    }
    let parsed: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("claude output not JSON: {e}"))?;

    if parsed
        .get("is_error")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        let msg = parsed
            .get("result")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("claude reported an error");
        return Err(msg.to_string());
    }

    let body = parsed
        .get("result")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if body.is_empty() {
        return Err("claude produced an empty draft".to_string());
    }
    Ok(body)
}

/// Map a publish `target` to its platform compose URL. Pure + tested so the
/// table can't silently drift and unknown targets are always rejected (mirrors
/// `pty.rs::run_script_for`). Both URLs land the user on the platform's own
/// compose surface — there is no automation behind them.
fn compose_url_for(target: &str) -> Result<&'static str, String> {
    match target {
        "linkedin" => Ok("https://www.linkedin.com/feed/?shareActive=true"),
        "reddit" => Ok("https://www.reddit.com/submit"),
        "x" => Ok("https://x.com/compose/post"),
        "instagram" => Ok("https://www.instagram.com/"),
        "tiktok" => Ok("https://www.tiktok.com/upload"),
        "facebook" => Ok("https://www.facebook.com/"),
        other => Err(format!("unknown publish target: {other}")),
    }
}

/// Open the platform compose page in the user's REAL browser via the `opener`
/// plugin. Assisted-manual ONLY: the human pastes the copied draft and clicks
/// post. NO automation, NO cookies, NO headless login.
///
/// `app: AppHandle` is injected by Tauri (not part of the JS-facing args), so
/// the invoke signature stays `publisher_open_compose(target)`.
#[tauri::command]
pub fn publisher_open_compose(app: tauri::AppHandle, target: String) -> Result<(), String> {
    let url = compose_url_for(&target)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open compose URL: {e}"))
}

#[cfg(test)]
mod publisher_tests {
    use super::*;

    #[test]
    fn known_targets_map_to_compose_urls() {
        assert_eq!(
            compose_url_for("linkedin").unwrap(),
            "https://www.linkedin.com/feed/?shareActive=true"
        );
        assert_eq!(
            compose_url_for("reddit").unwrap(),
            "https://www.reddit.com/submit"
        );
        assert_eq!(compose_url_for("x").unwrap(), "https://x.com/compose/post");
        assert_eq!(
            compose_url_for("instagram").unwrap(),
            "https://www.instagram.com/"
        );
        assert_eq!(
            compose_url_for("tiktok").unwrap(),
            "https://www.tiktok.com/upload"
        );
        assert_eq!(
            compose_url_for("facebook").unwrap(),
            "https://www.facebook.com/"
        );
    }

    #[test]
    fn unknown_target_is_rejected() {
        assert!(compose_url_for("twitter").is_err());
        assert!(compose_url_for("snapchat").is_err());
        assert!(compose_url_for("").is_err());
    }

    #[test]
    fn compose_urls_are_https_local_navigation_only() {
        // All 6 targets are plain platform compose pages — no automation endpoints.
        for t in ["linkedin", "reddit", "x", "instagram", "tiktok", "facebook"] {
            let url = compose_url_for(t).unwrap();
            assert!(
                url.starts_with("https://"),
                "compose URL must be https: {url}"
            );
        }
    }
}
