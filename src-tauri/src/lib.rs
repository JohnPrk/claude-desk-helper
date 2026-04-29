mod usage;

use notify_debouncer_mini::new_debouncer;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

struct WatcherState {
    _debouncer: Mutex<Option<Box<dyn std::any::Any + Send>>>,
}

#[tauri::command]
fn get_usage_snapshot() -> usage::UsageSnapshot {
    usage::snapshot()
}

#[tauri::command]
fn claude_projects_path() -> Option<PathBuf> {
    usage::claude_projects_dir()
}

fn emit_snapshot(app: &AppHandle) {
    let snap = usage::snapshot();
    let _ = app.emit("usage-update", &snap);
}

fn start_watcher(app: AppHandle) -> Arc<WatcherState> {
    let state = Arc::new(WatcherState {
        _debouncer: Mutex::new(None),
    });

    let Some(root) = usage::claude_projects_dir() else {
        log::warn!("~/.claude/projects not found — watcher idle");
        return state;
    };

    let app_for_events = app.clone();
    let mut debouncer = match new_debouncer(
        Duration::from_millis(500),
        move |res: notify_debouncer_mini::DebounceEventResult| match res {
            Ok(_events) => emit_snapshot(&app_for_events),
            Err(e) => log::error!("watch error: {:?}", e),
        },
    ) {
        Ok(d) => d,
        Err(e) => {
            log::error!("failed to create debouncer: {:?}", e);
            return state;
        }
    };

    if let Err(e) = debouncer
        .watcher()
        .watch(&root, notify::RecursiveMode::Recursive)
    {
        log::error!("failed to watch {:?}: {:?}", root, e);
        return state;
    }

    *state._debouncer.lock() = Some(Box::new(debouncer));

    let app_for_tick = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        emit_snapshot(&app_for_tick);
        loop {
            std::thread::sleep(Duration::from_secs(15));
            emit_snapshot(&app_for_tick);
        }
    });

    state
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle().clone();
            let watcher = start_watcher(handle);
            app.manage(watcher);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_usage_snapshot,
            claude_projects_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
