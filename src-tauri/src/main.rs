//! WeightCoach 主入口。
//! 职责边界（SRS 3.5）：Rust 只做数据库迁移、密钥、HTTP、定时器/托盘。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tray;
mod windows;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

fn writable_dir(path: &std::path::Path) -> bool {
    if std::fs::create_dir_all(path).is_err() {
        return false;
    }
    let probe = path.join(".wc-write-test");
    let ok = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

fn choose_data_base() -> std::path::PathBuf {
    // 优先使用当前账户的 APPDATA；受限账户则退回 LOCALAPPDATA，最后退回程序目录。
    for key in ["APPDATA", "LOCALAPPDATA"] {
        if let Ok(raw) = std::env::var(key) {
            let candidate = std::path::PathBuf::from(raw);
            if writable_dir(&candidate.join("WeightCoach")) {
                return candidate;
            }
        }
    }
    let fallback = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("WeightCoachData")))
        .unwrap_or_else(|| std::path::PathBuf::from("WeightCoachData"));
    let _ = std::fs::create_dir_all(&fallback);
    fallback
}

fn main() {
    let original_appdata = std::env::var("APPDATA").ok();
    let original_local = std::env::var("LOCALAPPDATA").ok();
    let base = choose_data_base();
    // 让 SQL 插件、备份与 WebView2 使用同一个可写基目录。
    std::env::set_var("APPDATA", &base);
    let app_dir = base.join("WeightCoach");
    let webview_dir = app_dir.join("webview2");
    let temp_dir = app_dir.join("temp");
    let config_dir = base.join("com.weightcoach.desktop");
    let _ = std::fs::create_dir_all(&app_dir);
    let _ = std::fs::create_dir_all(&webview_dir);
    let _ = std::fs::create_dir_all(&temp_dir);
    let _ = std::fs::create_dir_all(&config_dir);
    let _ = std::fs::create_dir_all(app_dir.join("backups"));
    // tauri-plugin-sql 会按系统 Known Folder 找 app config；同时把原始账户目录也建好，
    // 避免全新安装时因目录不存在直接 “拒绝访问”。
    if let Some(root) = original_appdata.as_deref() {
        let _ = std::fs::create_dir_all(std::path::Path::new(root).join("com.weightcoach.desktop"));
    }
    if let Some(root) = original_local.as_deref() {
        let _ = std::fs::create_dir_all(std::path::Path::new(root).join("com.weightcoach.desktop"));
    }
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_dir);
    // WebView2/crashpad 会写 %TEMP%；部分 Windows 账户的 TEMP 在受限盘上，
    // 会导致运行几十秒后报 "can't open file for write" 并崩溃。
    std::env::set_var("TEMP", &temp_dir);
    std::env::set_var("TMP", &temp_dir);

    let db_url = commands::system::data_db_url().expect("无法解析数据目录");
    let migrations = vec![
        Migration {
            version: 1,
            description: "WeightCoach 初始表结构（SRS 第 8 章）",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "目标达成日期（自设达成时间）",
            sql: include_str!("../migrations/002_goal_target_date.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "成员头像",
            sql: include_str!("../migrations/003_user_avatar.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(&db_url, migrations)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // FR-APP-04 单实例：重复启动只唤醒已有窗口
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::secrets::secret_set,
            commands::secrets::secret_status,
            commands::secrets::secret_delete,
            commands::ai::ai_chat,
            commands::weather::weather_fetch,
            commands::weather::city_search,
            commands::scheduler::scheduler_status,
            commands::scheduler::pause_reminders,
            commands::system::db_url,
            commands::system::set_autostart,
            commands::system::data_dir,
            commands::system::write_text_file,
            commands::system::read_text_file,
            commands::system::auto_backup,
            commands::system::open_data_dir,
        ])
        .setup(|app| {
            tray::create(app)?;
            windows::close_to_tray(app)?;
            commands::scheduler::start(app.handle().clone());
            // FR-SET-04：每日自动备份，保留 7 份（失败不阻塞启动）
            if let Err(e) = commands::system::auto_backup() {
                eprintln!("自动备份跳过：{e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WeightCoach");
}
