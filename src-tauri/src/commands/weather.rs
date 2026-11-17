//! 天气获取（SRS 9.3）：和风天气主源（可选 Key），Open-Meteo 兜底；缓存 60 分钟由前端仓储负责。
//! Rust 只做 HTTP 与字段映射，不在 rust 侧做业务评分（SRS 3.5）。

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Serialize, Clone)]
pub struct DailyForecast {
    pub date: String,        // fxDate → YYYY-MM-DD
    pub temp_max: f64,
    pub temp_min: f64,
    pub pop: Option<u32>,    // 降水概率 %
    pub wind_scale_day: Option<u32>, // 蒲福风级
    pub text_day: Option<String>,
    pub aqi: Option<u32>,
    pub humidity: Option<u32>,
    pub uv_index: Option<u32>,
}

#[derive(Serialize)]
pub struct WeatherResult {
    pub days: Vec<DailyForecast>,
    pub source: String, // qweather | open-meteo
}

#[derive(Serialize)]
pub struct CityHit {
    pub id: String,   // "lat,lon"，供两种 API 共用
    pub name: String,
    pub region: String,
}

/// 城市 ID 统一用 "lat,lon"；兼容用户旧数据中的纯数字（此时无法兜底，由前端提示重选）。
fn coordinates(city_id: &str) -> Option<(f64, f64)> {
    let mut it = city_id.split(',');
    let lat = it.next()?.trim().parse::<f64>().ok()?;
    let lon = it.next()?.trim().parse::<f64>().ok()?;
    if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) {
        Some((lat, lon))
    } else {
        None
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(*b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

async fn get_json(url: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("创建网络客户端失败：{e}"))?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("网络请求失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("服务返回 HTTP {}", resp.status().as_u16()));
    }
    resp.json::<Value>().await.map_err(|e| format!("解析响应失败：{e}"))
}

fn f64_str(v: Option<&Value>) -> Option<f64> {
    v?.as_str()?.parse::<f64>().ok()
}

fn u32_str(v: Option<&Value>) -> Option<u32> {
    f64_str(v).map(|n| n.round() as u32)
}

fn weather_text(code: u32) -> String {
    let text = match code {
        0 => "晴",
        1 | 2 => "多云",
        3 => "阴",
        45 | 48 => "雾",
        51..=57 => "毛毛雨",
        61..=67 => "降雨",
        71..=77 => "降雪",
        80..=82 => "阵雨",
        85 | 86 => "阵雪",
        95 => "雷暴",
        96 | 99 => "雷暴冰雹",
        _ => "天气变化",
    };
    text.to_string()
}

/// km/h → 蒲福风级（用于 SRS 天气评分）。
fn beaufort(kmh: f64) -> u32 {
    if kmh < 1.0 { 0 } else if kmh < 6.0 { 1 } else if kmh < 12.0 { 2 }
    else if kmh < 20.0 { 3 } else if kmh < 29.0 { 4 } else if kmh < 39.0 { 5 }
    else if kmh < 50.0 { 6 } else if kmh < 62.0 { 7 } else if kmh < 75.0 { 8 } else { 9 }
}

async fn qweather(lon: f64, lat: f64, key: &str) -> Result<Vec<DailyForecast>, String> {
    let loc = format!("{lon:.4},{lat:.4}");
    let forecast = get_json(&format!(
        "https://devapi.qweather.com/v7/weather/7d?location={loc}&key={key}"
    ))
    .await?;
    if forecast.get("code").and_then(Value::as_str) != Some("200") {
        return Err("和风天气返回异常".into());
    }
    let aqi = get_json(&format!(
        "https://devapi.qweather.com/v7/air/now?location={loc}&key={key}"
    ))
    .await
    .ok()
    .and_then(|v| v.get("now")?.get("aqi")?.as_str()?.parse::<u32>().ok());

    let days = forecast
        .get("daily")
        .and_then(Value::as_array)
        .ok_or("和风天气缺少 daily 字段")?;
    Ok(days
        .iter()
        .take(7)
        .map(|d| DailyForecast {
            date: d.get("fxDate").and_then(Value::as_str).unwrap_or("").to_string(),
            temp_max: f64_str(d.get("tempMax")).unwrap_or(20.0),
            temp_min: f64_str(d.get("tempMin")).unwrap_or(12.0),
            pop: u32_str(d.get("pop")),
            wind_scale_day: u32_str(d.get("windScaleDay")),
            text_day: d.get("textDay").and_then(Value::as_str).map(str::to_string),
            aqi,
            humidity: u32_str(d.get("humidity")),
            uv_index: u32_str(d.get("uvIndex")),
        })
        .collect())
}

async fn open_meteo(lat: f64, lon: f64) -> Result<Vec<DailyForecast>, String> {
    let forecast = get_json(&format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}\
         &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,\
         wind_speed_10m_max,relative_humidity_2m_max,uv_index_max&timezone=auto&forecast_days=7"
    ))
    .await?;
    let daily = forecast.get("daily").ok_or("Open-Meteo 缺少 daily 字段")?;
    let dates = daily.get("time").and_then(Value::as_array).ok_or("缺少日期序列")?;
    let codes = daily.get("weather_code").and_then(Value::as_array);
    let tmax = daily.get("temperature_2m_max").and_then(Value::as_array);
    let tmin = daily.get("temperature_2m_min").and_then(Value::as_array);
    let pops = daily.get("precipitation_probability_max").and_then(Value::as_array);
    let winds = daily.get("wind_speed_10m_max").and_then(Value::as_array);
    let hums = daily.get("relative_humidity_2m_max").and_then(Value::as_array);
    let uvs = daily.get("uv_index_max").and_then(Value::as_array);

    // AQI 单独接口；失败不阻塞天气主数据
    let aqi = get_json(&format!(
        "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=us_aqi&timezone=auto"
    ))
    .await
    .ok()
    .and_then(|v| v.get("current")?.get("us_aqi")?.as_f64())
    .map(|n| n.round() as u32);

    Ok(dates
        .iter()
        .enumerate()
        .take(7)
        .map(|(i, d)| DailyForecast {
            date: d.as_str().unwrap_or("").to_string(),
            temp_max: tmax.and_then(|a| a.get(i)).and_then(Value::as_f64).unwrap_or(20.0),
            temp_min: tmin.and_then(|a| a.get(i)).and_then(Value::as_f64).unwrap_or(12.0),
            pop: pops.and_then(|a| a.get(i)).and_then(Value::as_f64).map(|n| n.round() as u32),
            wind_scale_day: winds
                .and_then(|a| a.get(i))
                .and_then(Value::as_f64)
                .map(beaufort),
            text_day: codes
                .and_then(|a| a.get(i))
                .and_then(Value::as_f64)
                .map(|n| weather_text(n.round() as u32)),
            aqi,
            humidity: hums.and_then(|a| a.get(i)).and_then(Value::as_f64).map(|n| n.round() as u32),
            uv_index: uvs.and_then(|a| a.get(i)).and_then(Value::as_f64).map(|n| n.round() as u32),
        })
        .collect())
}

/// FR-PLN-01：关键词搜索城市，无定位权限。用 Open-Meteo Geocoding，无需 Key。
#[tauri::command]
pub async fn city_search(keyword: String) -> Result<Vec<CityHit>, String> {
    let q = keyword.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let v = get_json(&format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=8&language=zh&format=json",
        percent_encode(q)
    ))
    .await?;
    let results = v.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(results
        .iter()
        .filter_map(|r| {
            let lat = r.get("latitude")?.as_f64()?;
            let lon = r.get("longitude")?.as_f64()?;
            let name = r.get("name")?.as_str()?.to_string();
            let region = r
                .get("admin1")
                .and_then(Value::as_str)
                .or_else(|| r.get("country").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            Some(CityHit { id: format!("{lat:.4},{lon:.4}"), name, region })
        })
        .collect())
}

/// FR-PLN-02 / SRS 9.3：拉取 7 天预报。优先和风（配置了 Key 时），失败换 Open-Meteo。
#[tauri::command]
pub async fn weather_fetch(city_id: String, city_name: String, key: Option<String>) -> Result<WeatherResult, String> {
    let _ = city_name; // 保留参数便于将来按名称兜底检索
    let (lat, lon) = coordinates(&city_id)
        .ok_or("城市坐标无效，请在计划页重新选择城市")?;
    if let Some(k) = key.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(days) = qweather(lon, lat, k).await {
            return Ok(WeatherResult { days, source: "qweather".into() });
        }
    }
    let days = open_meteo(lat, lon).await?;
    Ok(WeatherResult { days, source: "open-meteo".into() })
}
