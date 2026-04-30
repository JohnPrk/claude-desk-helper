mod claude_api;
mod usage;

use claude_api::ApiUsage;
use std::sync::OnceLock;

use notify_debouncer_mini::new_debouncer;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
fn set_macos_accessory_app() {
    use objc2::class;
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    unsafe {
        let cls = class!(NSApplication);
        let app: *mut AnyObject = msg_send![cls, sharedApplication];
        // NSApplicationActivationPolicyAccessory = 1
        // No Dock icon, no Cmd-Tab entry. macOS no longer manages our
        // window with the regular Space mechanics, which is the only
        // configuration where the 'stationary' collection behavior is
        // honored reliably.
        let _: () = msg_send![app, setActivationPolicy: 1i64];
    }
}

#[cfg(not(target_os = "macos"))]
fn set_macos_accessory_app() {}

#[cfg(target_os = "macos")]
mod macos_pinning {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use std::os::raw::{c_int, c_void};
    use std::sync::OnceLock;
    use tauri::WebviewWindow;

    // NSWindowCollectionBehavior bits (NSWindow.h)
    const CB_CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
    const CB_MOVE_TO_ACTIVE_SPACE: u64 = 1 << 1;
    const CB_MANAGED: u64 = 1 << 2;
    const CB_TRANSIENT: u64 = 1 << 3;
    const CB_STATIONARY: u64 = 1 << 4;
    const CB_PARTICIPATES_IN_CYCLE: u64 = 1 << 5;
    const CB_IGNORES_CYCLE: u64 = 1 << 6;
    const CB_FULLSCREEN_PRIMARY: u64 = 1 << 7;
    const CB_FULLSCREEN_AUXILIARY: u64 = 1 << 8;
    const CB_FULLSCREEN_NONE: u64 = 1 << 9;
    const CB_FULLSCREEN_ALLOWS_TILING: u64 = 1 << 11;
    const CB_FULLSCREEN_DISALLOWS_TILING: u64 = 1 << 12;
    const CB_PRIMARY: u64 = 1 << 16;
    const CB_AUXILIARY: u64 = 1 << 17;
    const CB_CAN_JOIN_ALL_APPS: u64 = 1 << 18;

    // Window level used by clawd: CGAssistiveTechHighWindowLevel = 1500.
    // Far above NSStatusWindowLevel (25), survives Mission Control overlays.
    const ASSISTIVE_LEVEL: i64 = 1500;
    // NSWindowAnimationBehaviorNone = 2.
    const ANIM_NONE: i64 = 2;

    type SLSMainConnectionID = unsafe extern "C" fn() -> c_int;
    type SLSSpaceCreate = unsafe extern "C" fn(c_int, c_int, c_int) -> c_int;
    type SLSSpaceSetAbsoluteLevel = unsafe extern "C" fn(c_int, c_int, c_int) -> c_int;
    type SLSShowSpaces = unsafe extern "C" fn(c_int, *const c_void) -> c_int;
    type SLSSpaceAddWindowsAndRemoveFromSpaces =
        unsafe extern "C" fn(c_int, c_int, *const c_void, c_int) -> c_int;

    struct SkyLight {
        _lib: libloading::Library,
        connection: c_int,
        space: c_int,
        add_windows_fn: SLSSpaceAddWindowsAndRemoveFromSpaces,
        show_spaces_fn: SLSShowSpaces,
    }

    fn skylight() -> Option<&'static SkyLight> {
        static CELL: OnceLock<Option<SkyLight>> = OnceLock::new();
        CELL.get_or_init(|| unsafe {
            let lib = libloading::Library::new(
                "/System/Library/PrivateFrameworks/SkyLight.framework/Versions/A/SkyLight",
            ).ok()?;

            let main_conn: libloading::Symbol<SLSMainConnectionID> =
                lib.get(b"SLSMainConnectionID\0").ok()?;
            let space_create: libloading::Symbol<SLSSpaceCreate> =
                lib.get(b"SLSSpaceCreate\0").ok()?;
            let space_abs_level: libloading::Symbol<SLSSpaceSetAbsoluteLevel> =
                lib.get(b"SLSSpaceSetAbsoluteLevel\0").ok()?;
            let show_spaces: libloading::Symbol<SLSShowSpaces> =
                lib.get(b"SLSShowSpaces\0").ok()?;
            let add_windows: libloading::Symbol<SLSSpaceAddWindowsAndRemoveFromSpaces> =
                lib.get(b"SLSSpaceAddWindowsAndRemoveFromSpaces\0").ok()?;

            let connection = main_conn();
            let space = space_create(connection, 1, 0);
            if space == 0 {
                return None;
            }
            // Absolute level 100 puts this Space outside the user's
            // left/right Mission Control swipe animation entirely.
            space_abs_level(connection, space, 100);

            // SLSShowSpaces wants an NSArray of NSNumber. Build via objc.
            if let Some(arr) = ns_number_array(space) {
                show_spaces(connection, arr);
            }

            let add_windows_fn: SLSSpaceAddWindowsAndRemoveFromSpaces = *add_windows;
            let show_spaces_fn: SLSShowSpaces = *show_spaces;
            Some(SkyLight {
                _lib: lib,
                connection,
                space,
                add_windows_fn,
                show_spaces_fn,
            })
        }).as_ref()
    }

    fn ns_number_array(value: c_int) -> Option<*const c_void> {
        use objc2::class;
        unsafe {
            let cls_num = class!(NSNumber);
            let cls_arr = class!(NSArray);
            let num: *mut AnyObject = msg_send![cls_num, numberWithInt: value];
            if num.is_null() {
                return None;
            }
            let arr: *mut AnyObject = msg_send![cls_arr, arrayWithObject: num];
            if arr.is_null() {
                return None;
            }
            Some(arr as *const c_void)
        }
    }

    fn delegate_window_to_stationary_space(ns_window: *mut AnyObject) -> bool {
        let Some(sl) = skylight() else { return false };
        unsafe {
            let window_number: i64 = msg_send![ns_window, windowNumber];
            if window_number == 0 {
                return false;
            }
            let Some(arr) = ns_number_array(window_number as c_int) else {
                return false;
            };
            // Last arg `7` matches clawd's call: bitmask for which existing
            // Space memberships to remove the window from.
            let _ = (sl.add_windows_fn)(sl.connection, sl.space, arr, 7);
            true
        }
    }

    // NSWindowStyleMaskNonactivatingPanel = 1 << 7 — kept here as a
    // reference. Currently NOT applied (see convert_to_panel_once below)
    // because it blocks WebKit text input by preventing the panel from
    // becoming key for the embedded webview.
    #[allow(dead_code)]
    const STYLE_NONACTIVATING_PANEL: u64 = 1 << 7;

    extern "C" {
        fn object_setClass(obj: *mut c_void, cls: *const c_void) -> *const c_void;
    }

    fn convert_to_panel_once(ns_window: *mut AnyObject) {
        use objc2::class;
        use std::sync::atomic::{AtomicBool, Ordering};
        static DONE: AtomicBool = AtomicBool::new(false);
        if DONE.swap(true, Ordering::SeqCst) {
            return;
        }
        unsafe {
            // Class-swap NSWindow → NSPanel. NSPanel inherits from NSWindow,
            // so the vtable stays compatible.
            //
            // We deliberately DO NOT add NSWindowStyleMaskNonactivatingPanel
            // here. Adding it gives nicer single-click drag UX, but blocks
            // WebKit text input because the panel never becomes 'key' for
            // input fields. With it dropped, Settings inputs (org id,
            // session cookie) work normally; the trade-off is that the very
            // first click on the pet may activate the app rather than start
            // a drag — second click drags. focus_for_input below mitigates
            // this for the Settings flow specifically.
            let panel_cls = class!(NSPanel);
            let _ = object_setClass(
                ns_window as *mut c_void,
                panel_cls as *const _ as *const c_void,
            );
            // setBecomesKeyOnlyIfNeeded:false so any click that needs the
            // window for input promotes us to key window immediately.
            let _: () = msg_send![ns_window, setBecomesKeyOnlyIfNeeded: false];
        }
    }

    pub fn apply(window: &WebviewWindow) {
        let Ok(ptr) = window.ns_window() else { return };
        let ns_window = ptr as *mut AnyObject;
        if ns_window.is_null() {
            return;
        }

        // 1) NSPanel conversion (idempotent, runs once).
        convert_to_panel_once(ns_window);

        unsafe {
            // 2) Collection behavior — explicit clear + set so stale bits
            //    don't leave the window participating in Spaces management.
            let current: u64 = msg_send![ns_window, collectionBehavior];
            let clear_mask = CB_MOVE_TO_ACTIVE_SPACE
                | CB_MANAGED
                | CB_TRANSIENT
                | CB_PARTICIPATES_IN_CYCLE
                | CB_FULLSCREEN_PRIMARY
                | CB_FULLSCREEN_NONE
                | CB_FULLSCREEN_ALLOWS_TILING
                | CB_PRIMARY
                | CB_AUXILIARY
                | CB_CAN_JOIN_ALL_APPS;
            let set_mask = CB_CAN_JOIN_ALL_SPACES
                | CB_STATIONARY
                | CB_FULLSCREEN_AUXILIARY
                | CB_IGNORES_CYCLE
                | CB_FULLSCREEN_DISALLOWS_TILING;
            let next = (current & !clear_mask) | set_mask;
            if next != current {
                let _: () = msg_send![ns_window, setCollectionBehavior: next];
            }

            let _: () = msg_send![ns_window, setCanHide: false];
            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
            let _: () = msg_send![ns_window, setLevel: ASSISTIVE_LEVEL];
            let _: () = msg_send![ns_window, setAnimationBehavior: ANIM_NONE];
        }

        // 3) SkyLight: re-add the window to our private system Space and
        //    re-issue SLSShowSpaces. The re-show fixes the case where a
        //    different app's overlay (image viewer, fullscreen, etc.)
        //    occludes our private Space.
        delegate_window_to_stationary_space(ns_window);
        if let Some(sl) = skylight() {
            if let Some(arr) = ns_number_array(sl.space) {
                unsafe { let _ = (sl.show_spaces_fn)(sl.connection, arr); }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn set_macos_panel_behavior(window: &WebviewWindow) {
    macos_pinning::apply(window);
}

#[cfg(not(target_os = "macos"))]
fn set_macos_panel_behavior(_window: &WebviewWindow) {}

struct WatcherState {
    _debouncer: Mutex<Option<Box<dyn std::any::Any + Send>>>,
}

#[derive(Default)]
struct ApiState {
    config: Mutex<Option<(String, String)>>, // (org_id, cookie)
    latest: Mutex<Option<ApiUsage>>,
    last_error: Mutex<Option<String>>,
}

fn api_state() -> &'static ApiState {
    static CELL: OnceLock<ApiState> = OnceLock::new();
    CELL.get_or_init(ApiState::default)
}

#[derive(serde::Serialize, Clone)]
struct CombinedSnapshot {
    #[serde(flatten)]
    inner: usage::UsageSnapshot,
    api: Option<ApiUsage>,
    api_error: Option<String>,
}

fn build_combined_snapshot() -> CombinedSnapshot {
    let inner = usage::snapshot();
    let api = api_state().latest.lock().clone();
    let api_error = api_state().last_error.lock().clone();
    CombinedSnapshot { inner, api, api_error }
}

#[tauri::command]
fn get_usage_snapshot() -> CombinedSnapshot {
    build_combined_snapshot()
}

#[tauri::command]
fn set_api_config(org_id: Option<String>, cookie: Option<String>) -> Result<(), String> {
    let pair = match (org_id, cookie) {
        (Some(o), Some(c)) if !o.trim().is_empty() && !c.trim().is_empty() => {
            Some((o.trim().to_string(), c.trim().to_string()))
        }
        _ => None,
    };
    *api_state().config.lock() = pair;
    if api_state().config.lock().is_none() {
        *api_state().latest.lock() = None;
        *api_state().last_error.lock() = None;
    }
    Ok(())
}

#[tauri::command]
fn test_api_config(org_id: String, cookie: String) -> Result<ApiUsage, String> {
    claude_api::fetch_usage(&org_id, &cookie)
}

#[tauri::command]
fn claude_projects_path() -> Option<PathBuf> {
    usage::claude_projects_dir()
}

#[tauri::command]
fn set_tray_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_title(Some(title)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Force the main window into key+active state so WebKit text inputs (like
/// the org id / cookie fields in Settings) actually receive paste and
/// keystrokes. Called from JS whenever Settings opens.
#[tauri::command]
fn focus_for_input(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let _ = window.show();
    let _ = window.set_focus();

    #[cfg(target_os = "macos")]
    {
        use objc2::class;
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        unsafe {
            let nsapp_cls = class!(NSApplication);
            let nsapp: *mut AnyObject = msg_send![nsapp_cls, sharedApplication];
            // 'true' here is fine for our accessory app — there's no Dock
            // icon to flash and we want keyboard input to flow.
            let _: () = msg_send![nsapp, activateIgnoringOtherApps: true];

            if let Ok(ptr) = window.ns_window() {
                let ns_window = ptr as *mut AnyObject;
                if !ns_window.is_null() {
                    let nil: *const AnyObject = std::ptr::null();
                    let _: () = msg_send![ns_window, makeKeyAndOrderFront: nil];
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn toggle_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn emit_snapshot(app: &AppHandle) {
    let combined = build_combined_snapshot();
    let _ = app.emit("usage-update", &combined);
}

fn start_api_poller(app: AppHandle) {
    std::thread::spawn(move || loop {
        let cfg = api_state().config.lock().clone();
        if let Some((org, cookie)) = cfg {
            match claude_api::fetch_usage(&org, &cookie) {
                Ok(api) => {
                    *api_state().latest.lock() = Some(api);
                    *api_state().last_error.lock() = None;
                    emit_snapshot(&app);
                }
                Err(e) => {
                    *api_state().last_error.lock() = Some(e);
                    emit_snapshot(&app);
                }
            }
        }
        std::thread::sleep(Duration::from_secs(30));
    });
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

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "펫 보이기/숨기기", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "설정...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &settings_item, &quit_item])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(true)
        .title("🐼 …")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "settings" => {
                let _ = focus_for_input(app.clone());
                let _ = app.emit("show-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Hide the Dock icon FIRST so the window we're about to attach
            // panel-behavior to is created under accessory mode.
            set_macos_accessory_app();

            let handle = app.handle().clone();
            build_tray(&handle)?;

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    // 1) Apply once during setup.
                    set_macos_panel_behavior(&window);

                    // 2) Apply again ~200ms later — tao re-applies its own
                    //    collection-behavior bits during early window
                    //    lifecycle, after our setup hook has returned.
                    let w_for_thread = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(200));
                        let w_for_main = w_for_thread.clone();
                        let _ = w_for_thread.run_on_main_thread(move || {
                            set_macos_panel_behavior(&w_for_main);
                        });
                    });

                    // 3) Re-apply on every relevant lifecycle event. Some
                    //    tao/macOS interactions (focus, Space change, app
                    //    activation) reset the collection behavior; we
                    //    enforce it back to our values each time.
                    let w_for_event = window.clone();
                    window.on_window_event(move |event| {
                        use tauri::WindowEvent;
                        match event {
                            WindowEvent::Focused(_)
                            | WindowEvent::Resized(_)
                            | WindowEvent::Moved(_) => {
                                let w = w_for_event.clone();
                                let _ = w_for_event.run_on_main_thread(move || {
                                    set_macos_panel_behavior(&w);
                                });
                            }
                            _ => {}
                        }
                    });

                    // 4) Periodic re-application (~1.5s). Window focus
                    //    events only fire on OUR window's transitions; when
                    //    another app activates and visually covers our
                    //    SkyLight Space, we don't get an event. Without
                    //    this tick the panda only reappears after the user
                    //    clicks somewhere — exactly the symptom users
                    //    reported as "I click the image, panda disappears
                    //    until I click again." 1.5s is the slowest that
                    //    feels instant; faster wastes CPU on a no-op
                    //    SLSShowSpaces call.
                    let w_for_tick = window.clone();
                    std::thread::spawn(move || loop {
                        std::thread::sleep(Duration::from_millis(1500));
                        let w = w_for_tick.clone();
                        if w_for_tick
                            .run_on_main_thread(move || {
                                set_macos_panel_behavior(&w);
                            })
                            .is_err()
                        {
                            break;
                        }
                    });
                }
            }

            let watcher = start_watcher(handle.clone());
            app.manage(watcher);
            start_api_poller(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_usage_snapshot,
            claude_projects_path,
            set_tray_title,
            toggle_main_window,
            focus_for_input,
            set_api_config,
            test_api_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
