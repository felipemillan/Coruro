// pty.rs — embedded pseudo-terminal sessions for the Ask tab.
//
// Spawns an interactive CLI (Claude Code) inside a PTY so the frontend can
// host a real terminal (xterm.js). One session per id; output streams to the
// webview via `pty-output` events, exit via `pty-exit`.
//
// The command runs through `/bin/zsh -lc` so the user's login PATH applies —
// GUI apps don't inherit the shell environment, and `claude` is typically
// installed via npm/homebrew paths only a login shell knows about. The prompt
// is passed through an environment variable (not interpolated into the script)
// so arbitrary user text can't break out of the shell command.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Arc<Mutex<HashMap<String, PtySession>>>);

type Sessions = Arc<Mutex<HashMap<String, PtySession>>>;

#[derive(Clone, Serialize)]
struct PtyOutput<'a> {
    id: &'a str,
    data: &'a str,
}

#[derive(Clone, Serialize)]
struct PtyExit<'a> {
    id: &'a str,
    code: Option<u32>,
}

/// Stream a PTY reader to the webview via `pty-output`, then emit `pty-exit` and
/// drop the session on EOF. A trailing incomplete UTF-8 sequence is kept in
/// `carry` so multibyte chars never split across two events. Shared by both
/// spawn paths so the streaming/cleanup logic lives in exactly one place.
fn spawn_pty_reader(
    app: AppHandle,
    sessions: Sessions,
    id: String,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let valid_up_to = match std::str::from_utf8(&carry) {
                        Ok(_) => carry.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    if valid_up_to > 0 {
                        // Safety: validated prefix above.
                        let text = unsafe { std::str::from_utf8_unchecked(&carry[..valid_up_to]) };
                        let _ = app.emit(
                            "pty-output",
                            PtyOutput {
                                id: &id,
                                data: text,
                            },
                        );
                        carry.drain(..valid_up_to);
                    }
                    // A carry that never completes (binary garbage) is dropped
                    // once it can't be a partial code point anymore.
                    if carry.len() > 4 {
                        carry.clear();
                    }
                }
            }
        }
        // EOF: reap the child for an exit code, then clean up the session.
        let code = {
            let mut sessions = match sessions.lock() {
                Ok(s) => s,
                Err(p) => p.into_inner(),
            };
            sessions
                .remove(&id)
                .and_then(|mut s| s.child.wait().ok().map(|st| st.exit_code()))
        };
        let _ = app.emit("pty-exit", PtyExit { id: &id, code });
    });
}

/// Open a PTY of the given size, spawn `cmd` in it, register the session under
/// `id`, and start the reader thread. Shared by `pty_spawn` and `pty_spawn_cmd`
/// — the only difference between those commands is how `cmd` is built.
fn spawn_in_pty(
    app: AppHandle,
    state: &State<'_, PtyState>,
    id: String,
    cmd: CommandBuilder,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if sessions.contains_key(&id) {
        return Err(format!("session {id} already exists"));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    sessions.insert(
        id.clone(),
        PtySession {
            writer,
            master: pair.master,
            child,
        },
    );
    drop(sessions);

    spawn_pty_reader(app, Arc::clone(&state.0), id, reader);
    Ok(())
}

/// Spawn an interactive `claude` session in a PTY rooted at `cwd`.
/// `prompt` (optional) becomes the initial question. Errors are surfaced as
/// strings so the frontend can show them inline.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    cwd: String,
    prompt: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Login shell resolves PATH; the prompt rides in an env var so no shell
    // quoting of user input is ever needed. Sessions launch through `dgc`
    // (graperoot dual-graph launcher: scans the project, then starts claude
    // with the MCP context server attached) when installed, falling back to
    // plain `claude`. Model pinned to Sonnet 4.6 — interactive sessions bill
    // against the user's plan, and Sonnet is the right cost/quality tier for
    // repo Q&A.
    const MODEL: &str = "--model=claude-sonnet-4-6";
    let has_prompt = prompt.as_deref().is_some_and(|p| !p.trim().is_empty());
    let script = if has_prompt {
        format!(
            "if command -v dgc >/dev/null 2>&1; then exec dgc . \"$CORURO_PROMPT\" {MODEL}; \
             else exec claude {MODEL} \"$CORURO_PROMPT\"; fi"
        )
    } else {
        format!(
            "if command -v dgc >/dev/null 2>&1; then exec dgc . {MODEL}; \
             else exec claude {MODEL}; fi"
        )
    };
    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.args(["-lc", &script]);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    if has_prompt {
        if let Some(p) = &prompt {
            cmd.env("CORURO_PROMPT", p);
        }
    }

    spawn_in_pty(app, &state, id, cmd, cols, rows)
}

/// Forward keystrokes from xterm.js to the PTY.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("no such session")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Keep the PTY size in sync with the rendered terminal.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("no such session")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Terminate a session. The reader thread observes EOF and emits `pty-exit`.
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Map a validated `repo_type` to its hardcoded run command. Pure + tested so
/// the command table can't silently drift and unknown types are always
/// rejected — this is the guarantee that no user-supplied string enters the
/// shell script.
fn run_script_for(repo_type: &str) -> Result<&'static str, String> {
    match repo_type {
        "Tauri" => Ok("npm run tauri dev"),
        "NextJs" | "NodeJs" => Ok("npm run dev"),
        "Cargo" => Ok("cargo run"),
        "Make" => Ok("make"),
        other => Err(format!("unknown repo_type: {other}")),
    }
}

/// Spawn a project run/build command (dev server, cargo run, etc.) in a PTY.
/// Takes repo_type (validated enum string) and maps it to a HARDCODED shell
/// command — no user-supplied strings ever enter the shell script.
#[tauri::command]
pub fn pty_spawn_cmd(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    cwd: String,
    repo_type: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // The script is a &'static str from the match — never user input.
    let script = run_script_for(&repo_type)?;

    // Use login shell so PATH includes npm/cargo/make regardless of GUI launch context.
    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.args(["-lc", script]);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");

    spawn_in_pty(app, &state, id, cmd, cols, rows)
}

#[cfg(test)]
mod pty_tests {
    use super::*;

    #[test]
    fn known_repo_types_map_to_their_commands() {
        assert_eq!(run_script_for("Tauri").unwrap(), "npm run tauri dev");
        assert_eq!(run_script_for("NextJs").unwrap(), "npm run dev");
        assert_eq!(run_script_for("NodeJs").unwrap(), "npm run dev");
        assert_eq!(run_script_for("Cargo").unwrap(), "cargo run");
        assert_eq!(run_script_for("Make").unwrap(), "make");
    }

    #[test]
    fn unknown_repo_type_is_rejected() {
        assert!(run_script_for("Haskell").is_err());
        assert!(run_script_for("").is_err());
    }
}
