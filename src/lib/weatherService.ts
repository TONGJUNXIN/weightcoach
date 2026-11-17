/**
 * 天气服务编排（SRS 9.3 / FR-PLN-09）：
 * 缓存优先 → TTL 60 分钟过期则请求（和风主源，Open-Meteo 兜底）→ 写缓存；
 * 失败用缓存并标注时间；无缓存则全部按室内生成，页面不空白、不弹错误框。
 */
import { invoke } from "@tauri-apps/api/core";
import { settingsRepo, SETTINGS, weatherRepo } from "@/db/repositories";
import { cacheFresh, indoorFallbackDay, type WeatherDay } from "@/domain/weather";
import { addDays, fmtDate } from "@/lib/date";

interface RawForecast {
  date: string;
  temp_max: number;
  temp_min: number;
  pop: number | null;
  wind_scale_day: number | null;
  text_day: string | null;
  aqi: number | null;
  humidity: number | null;
  uv_index: number | null;
}

interface RawWeatherResult {
  days: RawForecast[];
  source: string;
}

export interface CityHit {
  id: string; // "lat,lon"
  name: string;
  region: string;
}

export interface WeatherSnapshot {
  days: WeatherDay[];
  source: "cache" | "qweather" | "open-meteo" | "unavailable";
  fetchedAt: string | null;
  stale: boolean; // 是否使用过期缓存
  unavailable: boolean; // 是否完全无数据（全室内兜底）
}

function toWeatherDay(raw: RawForecast): WeatherDay {
  return {
    date: raw.date,
    tempMax: raw.temp_max,
    tempMin: raw.temp_min,
    pop: raw.pop,
    windScale: raw.wind_scale_day,
    text: raw.text_day,
    aqi: raw.aqi,
    humidity: raw.humidity,
    uvIndex: raw.uv_index,
  };
}

/** FR-PLN-01：关键词搜索城市，无定位权限；失败返回空数组，由页面显示可重试提示。 */
export async function searchCity(keyword: string): Promise<CityHit[]> {
  try {
    return await invoke<CityHit[]>("city_search", { keyword });
  } catch {
    return [];
  }
}

export async function loadWeather(
  cityId: string,
  cityName: string,
  force = false,
): Promise<WeatherSnapshot> {
  const dates = Array.from({ length: 7 }, (_, i) => fmtDate(addDays(new Date(), i)));
  const cached = await weatherRepo.cached(cityId, dates);
  if (!force && cached && cacheFresh(cached.fetchedAt)) {
    return { days: cached.days, source: "cache", fetchedAt: cached.fetchedAt, stale: false, unavailable: false };
  }

  try {
    const key = await settingsRepo.get(SETTINGS.weatherKey);
    const result = await invoke<RawWeatherResult>("weather_fetch", { cityId, cityName, key });
    if (!result.days.length) throw new Error("天气返回为空");
    const days = result.days.slice(0, 7).map(toWeatherDay);
    await weatherRepo.save(cityId, days);
    return {
      days,
      source: result.source === "qweather" ? "qweather" : "open-meteo",
      fetchedAt: new Date().toISOString(),
      stale: false,
      unavailable: false,
    };
  } catch {
    if (cached) {
      return { days: cached.days, source: "cache", fetchedAt: cached.fetchedAt, stale: true, unavailable: false };
    }
    return {
      days: dates.map(indoorFallbackDay),
      source: "unavailable",
      fetchedAt: null,
      stale: true,
      unavailable: true,
    };
  }
}
