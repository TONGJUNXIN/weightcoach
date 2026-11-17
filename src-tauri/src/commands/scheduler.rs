//! 定时器（SRS 4.4 / 第 10 章）：tokio 每 60 秒检查一次本地时间。
//! 07:00 → reminder://weight；21:00 → reminder://medication；
//! 周一 08:30 → reminder://review。前端查库决定是否真的弹窗（去重）。

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use chrono::{Datelike, Local, Timelike};
use tauri::{AppHandle, Emitter};

/// 暂停提醒截止时间（Unix 秒）；0 = 未暂停。FR-APP-09。
static PAUSED_UNTIL: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn scheduler_status() -> Option<u64> {
    let v = PAUSED_UNTIL.load(Ordering::SeqCst);
    if v > 0 { Some(v) } else { None }
}

#[tauri::command]
pub fn pause_reminders(minutes: u32) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    PAUSED_UNTIL.store(now + minutes as u64 * 60, Ordering::SeqCst);
}

fn is_paused() -> bool {
    let until = PAUSED_UNTIL.load(Ordering::SeqCst);
    if until == 0 { return false; }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now < until
}

/// 当前本地 (时, 分, 星期)（0=周一）。
/// 必须用本地时间：此前直接对 UNIX 秒取模，得到的是 UTC，导致中国时区提醒整体偏移 8 小时。
fn local_hm_weekday() -> (u32, u32, u32) {
    let now = Local::now();
    (now.hour(), now.minute(), now.weekday().num_days_from_monday())
}

/// 时点映射（纯函数，便于单测）：07 点体重、21 点用药、周一 08 点复盘。
fn reminder_key(hour: u32, weekday: u32) -> &'static str {
    match (hour, weekday) {
        (7, _) => "reminder://weight",
        (21, _) => "reminder://medication",
        (8, 0) => "reminder://review",
        _ => "",
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_key = String::new();
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if is_paused() { continue; }
            let (h, _m, wd) = local_hm_weekday();
            // 命中时点则 emit；同一天/周只发一次由 last_key 粗去重 + 前端查库兜底
            let key = reminder_key(h, wd).to_string();
            if !key.is_empty() && key != last_key {
                let _ = app.emit(&key, ());
            }
            if key.is_empty() {
                last_key = String::new();
            } else {
                last_key = key;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::reminder_key;

    #[test]
    fn maps_local_clock_to_reminders() {
        assert_eq!(reminder_key(7, 0), "reminder://weight");
        assert_eq!(reminder_key(7, 6), "reminder://weight");
        assert_eq!(reminder_key(21, 3), "reminder://medication");
        assert_eq!(reminder_key(8, 0), "reminder://review");
        assert_eq!(reminder_key(8, 1), "");
        assert_eq!(reminder_key(9, 0), "");
        assert_eq!(reminder_key(15, 0), "");
        assert_eq!(reminder_key(5, 0), "");
    }
}
