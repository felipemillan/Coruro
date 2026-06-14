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

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
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

    // Reader thread: stream PTY output to the webview, keeping any trailing
    // incomplete UTF-8 sequence in `carry` so multibyte chars never split
    // across two events.
    let sessions_arc = Arc::clone(&state.0);
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
            let mut sessions = match sessions_arc.lock() {
                Ok(s) => s,
                Err(p) => p.into_inner(),
            };
            sessions
                .remove(&id)
                .and_then(|mut s| s.child.wait().ok().map(|st| st.exit_code()))
        };
        let _ = app.emit("pty-exit", PtyExit { id: &id, code });
    });

    Ok(())
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
    // Map repo_type to a COMPILE-TIME constant shell script. Never interpolate.
    let script: &'static str = match repo_type.as_str() {
        "Tauri" => "npm run tauri dev",
        "NextJs" => "npm run dev",
        "NodeJs" => "npm run dev",
        "Cargo" => "cargo run",
        "Make" => "make",
        _ => return Err(format!("unknown repo_type: {repo_type}")),
    };

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

    // Use login shell so PATH includes npm/cargo/make regardless of GUI launch context.
    // The script string is a &'static str from the match above — never user input.
    let mut cmd = CommandBuilder::new("/bin/zsh");
    cmd.args(["-lc", script]);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
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

    // Reader thread: identical to pty_spawn — stream PTY output via pty-output events.
    let sessions_arc = Arc::clone(&state.0);
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
                    if carry.len() > 4 {
                        carry.clear();
                    }
                }
            }
        }
        let code = {
            let mut sessions = match sessions_arc.lock() {
                Ok(s) => s,
                Err(p) => p.into_inner(),
            };
            sessions
                .remove(&id)
                .and_then(|mut s| s.child.wait().ok().map(|st| st.exit_code()))
        };
        let _ = app.emit("pty-exit", PtyExit { id: &id, code });
    });

    Ok(())
}
