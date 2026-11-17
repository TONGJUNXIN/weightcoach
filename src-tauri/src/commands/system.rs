//! 系统级命令（SRS 8：数据目录 %APPDATA%/WeightCoach）。

use std::path::PathBuf;

/// 数据目录绝对路径。tauri-plugin-sql 会把绝对路径直接作为数据库路径
/// （PathBuf::push 绝对路径会替换前缀），从而实现 SRS 指定目录。
pub fn data_db_url() -> Result<String, String> {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .map_err(|_| "未找到 APPDATA 环境变量".to_string())?;
    let dir = base.join("WeightCoach");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    Ok(format!("sqlite:{}", dir.join("weightcoach.db").to_string_lossy()))
}

#[tauri::command]
pub fn db_url() -> Result<String, String> {
    data_db_url()
}

/// FR-APP-05：开机自启默认开启，可在设置关闭
#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|e| format!("设置开机自启失败：{e}"))
}

/// 数据目录绝对路径（设置页「关于 / 数据目录入口」用）。
#[tauri::command]
pub fn data_dir() -> Result<String, String> {
    let base = std::env::var("APPDATA").map_err(|_| "未找到 APPDATA 环境变量".to_string())?;
    Ok(PathBuf::from(base).join("WeightCoach").to_string_lossy().to_string())
}

/// 写文本文件到任意绝对路径（导出 JSON/CSV 用；路径由前端 dialog 选择）。
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入失败：{e}"))
}

/// 读文本文件（恢复备份用）。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取失败：{e}"))
}

/// 每日自动备份保留 7 份（FR-SET-04）：把数据库文件复制到 backups 目录，按日期命名。
#[tauri::command]
pub fn auto_backup() -> Result<String, String> {
    let base = std::env::var("APPDATA").map_err(|_| "未找到 APPDATA 环境变量".to_string())?;
    let dir = PathBuf::from(&base).join("WeightCoach");
    let backup_dir = dir.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("无法创建备份目录：{e}"))?;
    let db = dir.join("weightcoach.db");
    if !db.exists() { return Err("数据库文件不存在".to_string()); }
    // 用本地日期（UTC+8 近似：系统本地时间）；格式 YYYY-MM-DD
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let days = secs.div_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    let name = format!("{y:04}-{m:02}-{d:02}.db");
    let dest = backup_dir.join(&name);
    std::fs::copy(&db, &dest).map_err(|e| format!("备份失败：{e}"))?;
    // 保留最近 7 份
    let mut files: Vec<_> = std::fs::read_dir(&backup_dir)
        .map_err(|e| format!("读取备份目录失败：{e}"))?
        .filter_map(|e| e.ok()).filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("db"))
        .collect();
    files.sort_by_key(|e| e.file_name());
    while files.len() > 7 {
        if let Some(old) = files.first() { let _ = std::fs::remove_file(old.path()); }
        files.remove(0);
    }
    Ok(dest.to_string_lossy().to_string())
}

/// 公历日期换算（days since 1970-01-01 → 年月日），避免引入 chrono。
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

/// 在文件管理器中打开数据目录。
#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let base = std::env::var("APPDATA").map_err(|_| "未找到 APPDATA 环境变量".to_string())?;
    let dir = PathBuf::from(&base).join("WeightCoach");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{e}"))?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(|e| format!("打开目录失败：{e}"))?;
    Ok(())
}
