// publisher.rs — assisted-manual Publisher backend.
//
// Two read-only, network-free Tauri commands:
//   1. `publisher_render_assets` — renders share images LOCALLY by spawning a
//      sibling Node renderer project (`publisher-renderer/`) over stdio. The
//      renderer entry is resolved by ABSOLUTE path the same way the coruro-ai
//      sidecar is (see `commands.rs::resolve_sidecar` and docs/adr/0001):
//      Tauri's `shell().sidecar()` ENOENTs in release bundles, so we resolve
//      `current_exe()` ourselves and spawn the path directly.
//   2. `publisher_open_compose` — opens the platform's compose page in the
//      user's REAL browser via the `opener` plugin. No automation, no cookies,
//      no headless login: the human pastes the copied draft and clicks post.
//
// P0 invariants enforced here:
//   - Asset render is LOCAL ONLY (Node process over stdio; no network).
//   - No git logic lives in this file.
//   - Publishing is assisted-manual: this file only OPENS a URL; it never logs
//     in, replays cookies, or auto-posts.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri_plugin_opener::OpenerExt;

/// Graceful-degrade message reused everywhere the renderer can't run. Mirrors
/// the sidecar's missing-toolchain handling: a clear, actionable string instead
/// of a panic or an opaque OS error.
const RENDERER_MISSING: &str = "renderer not installed (run npm install in publisher-renderer/)";

/// Locate the Node renderer entry by ABSOLUTE path. Mirrors
/// `commands.rs::resolve_sidecar`: resolve `current_exe()` and probe known
/// locations / names ourselves rather than trusting `shell().sidecar()` (which
/// ENOENTs in release bundles — docs/adr/0001).
///
/// Probe order (first existing entry wins):
///   - Release: `<bundle>/Contents/Resources/publisher-renderer/<entry>`
///   - Dev:     `<repo-root>/publisher-renderer/<entry>` (current_exe is
///     `src-tauri/target/<profile>/<bin>`, so the repo root is four
///     ancestors up)
///   - Defensive: `<exe-dir>/publisher-renderer/<entry>`
///
/// Returns the absolute path to the entry file, or `None` when no renderer is
/// installed.
fn resolve_renderer_entry() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dirs: Vec<PathBuf> = Vec::new();

    // Release bundle: Contents/MacOS/<bin> -> Contents/Resources/publisher-renderer/
    if let Some(contents) = exe.parent().and_then(Path::parent) {
        dirs.push(contents.join("Resources").join("publisher-renderer"));
    }
    // Dev: src-tauri/target/<profile>/<bin> -> repo root is four ancestors up.
    if let Some(repo_root) = exe.ancestors().nth(4) {
        dirs.push(repo_root.join("publisher-renderer"));
    }
    // Defensive: a renderer copied next to the executable.
    if let Some(dir) = exe.parent() {
        dirs.push(dir.join("publisher-renderer"));
    }

    for dir in dirs {
        for entry_name in ["index.mjs", "render.mjs", "index.js"] {
            let p = dir.join(entry_name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// Blocking spawn of the renderer: write the request as ONE newline-terminated
/// JSON line to stdin, then read the renderer's response from stdout. Mirrors
/// `commands.rs::run_sidecar` (stdin write → EOF → read stdout). LOCAL ONLY —
/// the renderer is a plain Node process; it never reaches the network.
fn run_renderer(entry: &Path, payload: &[u8]) -> std::io::Result<String> {
    let mut child = Command::new("node")
        .arg(entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    // Write payload then drop stdin so the child sees EOF (one line in).
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

/// Render share assets for one repo/target LOCALLY and return the absolute PNG
/// paths the renderer wrote into `out_dir`.
///
/// `data_json` is the serialized draft payload (a JSON string); it is parsed and
/// embedded as structured JSON under `data` so the renderer never sees a
/// doubly-encoded string. The stdin line is `{repo, target, data, outDir}`; the
/// stdout line is `{assets:[...absolute png paths]}`.
///
/// Degrades gracefully: a missing renderer, missing `node_modules`, or absent
/// `node` returns `Err(RENDERER_MISSING)` rather than panicking (same spirit as
/// the sidecar's missing-toolchain handling). No network, no git.
#[tauri::command]
pub fn publisher_render_assets(
    repo_name: String,
    target: String,
    data_json: String,
    out_dir: String,
) -> Result<Vec<String>, String> {
    let entry = resolve_renderer_entry().ok_or_else(|| RENDERER_MISSING.to_string())?;
    // Dependencies must be installed (node_modules sibling of the entry).
    if let Some(dir) = entry.parent() {
        if !dir.join("node_modules").exists() {
            return Err(RENDERER_MISSING.to_string());
        }
    }

    // Parse the caller's draft data so it embeds as structured JSON.
    let data: serde_json::Value =
        serde_json::from_str(&data_json).map_err(|e| format!("invalid data_json: {e}"))?;

    let mut payload = serde_json::to_vec(&serde_json::json!({
        "repo": repo_name,
        "target": target,
        "data": data,
        "outDir": out_dir,
    }))
    .map_err(|e| e.to_string())?;
    payload.push(b'\n');

    let out = run_renderer(&entry, &payload).map_err(|e| {
        // A missing `node` binary surfaces as NotFound — same actionable message.
        if e.kind() == std::io::ErrorKind::NotFound {
            RENDERER_MISSING.to_string()
        } else {
            format!("renderer failed: {e}")
        }
    })?;

    let line = out.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    if line.is_empty() {
        return Err("renderer produced no output".to_string());
    }
    let parsed: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("renderer output not JSON: {e}"))?;
    let assets = parsed
        .get("assets")
        .and_then(|a| a.as_array())
        .ok_or_else(|| "renderer output missing assets array".to_string())?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    Ok(assets)
}

/// Map a publish `target` to its platform compose URL. Pure + tested so the
/// table can't silently drift and unknown targets are always rejected (mirrors
/// `pty.rs::run_script_for`). Both URLs land the user on the platform's own
/// compose surface — there is no automation behind them.
fn compose_url_for(target: &str) -> Result<&'static str, String> {
    match target {
        "linkedin" => Ok("https://www.linkedin.com/feed/?shareActive=true"),
        "reddit" => Ok("https://www.reddit.com/submit"),
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
    }

    #[test]
    fn unknown_target_is_rejected() {
        assert!(compose_url_for("twitter").is_err());
        assert!(compose_url_for("").is_err());
    }

    #[test]
    fn compose_urls_are_https_local_navigation_only() {
        // Both targets are plain platform compose pages — no automation endpoints.
        for t in ["linkedin", "reddit"] {
            let url = compose_url_for(t).unwrap();
            assert!(
                url.starts_with("https://"),
                "compose URL must be https: {url}"
            );
        }
    }
}
