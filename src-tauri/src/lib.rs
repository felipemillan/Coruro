mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::store_token,
            commands::get_token,
            commands::open_in_editor,
            commands::open_in_terminal,
            commands::git_ahead_behind,
            commands::git_branches,
            commands::git_fetch,
            commands::git_local_stats,
            commands::git_recent_commits,
            commands::git_commits_since,
            commands::git_commits_since_numstat,
            commands::git_dirty_stat,
            commands::ai_analyze,
            commands::ai_day_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
