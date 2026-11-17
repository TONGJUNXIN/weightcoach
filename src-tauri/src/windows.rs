//! 窗口行为（SRS 表 4-1 / FR-APP-02）：
//! 主窗关闭按钮 = 隐藏到托盘，不退出；退出只走托盘菜单。

use tauri::{AppHandle, Manager};

pub fn close_to_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle: AppHandle = app.handle().clone();
    if let Some(win) = app.get_webview_window("main") {
        win.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
        });
    }
    Ok(())
}
