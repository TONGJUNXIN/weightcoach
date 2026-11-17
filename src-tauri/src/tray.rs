//! 托盘（SRS 表 4-1 / FR-APP-03）。
//! 双击 = 显示主窗；右键菜单 = 打开 / 记体重 / 用药打卡 / 暂停提醒 30 分钟 / 退出。

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开主窗", true, None::<&str>)?;
    let log_weight = MenuItem::with_id(app, "log-weight", "记体重", true, None::<&str>)?;
    let med_check = MenuItem::with_id(app, "med-check", "用药打卡", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause-30", "暂停提醒 30 分钟", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &log_weight, &med_check, &pause, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().expect("缺图标"))
        .tooltip("减重提醒")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "log-weight" => {
                let _ = app.emit("tray://log-weight", ());
                show_main(app);
            }
            "med-check" => {
                let _ = app.emit("tray://med-check", ());
                show_main(app);
            }
            "pause-30" => {
                crate::commands::scheduler::pause_reminders(30);
            }
            "quit" => {
                app.exit(0); // FR-APP-08：退出前不弹确认
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
