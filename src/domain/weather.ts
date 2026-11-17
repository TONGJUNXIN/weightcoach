/**
 * 天气适宜度评分（SRS 6.13.3 + 需求分析 V0.3 表 9，纯函数）。
 * 公式口径不得擅改；子项分段与权重来自 V0.3 表 9，SRS V1.0 引用该表。
 */

export interface WeatherDay {
  date: string; // YYYY-MM-DD
  tempMax: number;
  tempMin: number;
  pop: number | null; // 降水概率 %
  windScale: number | null; // 风力等级
  text: string | null; // 天气现象
  aqi: number | null;
  humidity: number | null; // %
  uvIndex: number | null;
}

export type WeatherConclusion = "outdoor" | "outdoor_timed" | "indoor_preferred" | "indoor";

export interface WeatherScore {
  score: number; // 0–100
  conclusion: WeatherConclusion;
  hardBlock: boolean; // 触发硬规则，一律不排户外
  reasons: string[];
}

/** 缺失字段按中性分处理，避免把无数据误判为宜户外。 */
const NEUTRAL = 60;

function tempScore(t: number): number {
  if (t >= 15 && t <= 24) return 100;
  if ((t >= 10 && t < 15) || (t > 24 && t <= 28)) return 80;
  if ((t >= 5 && t < 10) || (t > 28 && t <= 31)) return 55;
  if ((t >= 0 && t < 5) || (t > 31 && t <= 33)) return 30;
  return 0;
}

function rainScore(pop: number): number {
  if (pop <= 10) return 100;
  if (pop <= 30) return 80;
  if (pop <= 50) return 55;
  if (pop <= 70) return 25;
  return 0;
}

function aqiScore(aqi: number): number {
  if (aqi <= 50) return 100;
  if (aqi <= 100) return 75;
  if (aqi <= 150) return 45;
  if (aqi <= 200) return 15;
  return 0;
}

function windScore(level: number): number {
  if (level <= 3) return 100;
  if (level === 4) return 80;
  if (level === 5) return 55;
  if (level === 6) return 25;
  return 0;
}

function humidityScore(h: number): number {
  if (h < 40) return 100; // 表 9 未列出 <40%，按干燥不影响户外处理
  if (h <= 70) return 100;
  if (h <= 80) return 75;
  if (h <= 85) return 50;
  return 25;
}

function uvScore(uv: number): number {
  if (uv <= 5) return 100;
  if (uv <= 7) return 80;
  if (uv <= 10) return 50;
  return 25;
}

const HARD_TEXT = /雷暴|雷电|暴雪|冰雪|沙尘|冰雹/;

/**
 * 按最高温计算 0–100 适宜度与结论。
 * 硬规则（雷暴/冰雪/沙尘/AQI>200/≥35℃/≤−5℃/风力≥7）优先，直接 0 分。
 */
export function weatherScore(day: WeatherDay): WeatherScore {
  const reasons: string[] = [];
  const hard: string[] = [];
  const t = day.tempMax;
  const wind = day.windScale;
  const aqi = day.aqi;

  if (day.text === "天气数据不可用") hard.push("天气数据不可用，室内优先");
  else if (day.text && HARD_TEXT.test(day.text)) hard.push(`${day.text}时不安排户外`);
  if (aqi !== null && aqi > 200) hard.push("空气质量很差");
  if (t >= 35) hard.push("高温 ≥35℃");
  if (t <= -5) hard.push("低温 ≤−5℃");
  if (wind !== null && wind >= 7) hard.push("风力 ≥7 级");

  const parts = [
    0.35 * tempScore(t),
    0.25 * rainScore(day.pop ?? NEUTRAL),
    0.2 * aqiScore(aqi ?? NEUTRAL),
    0.1 * windScore(wind ?? NEUTRAL / 20),
    0.05 * humidityScore(day.humidity ?? 60),
    0.05 * uvScore(day.uvIndex ?? NEUTRAL / 10),
  ];
  const raw = Math.round(parts.reduce((a, b) => a + b, 0));
  const score = hard.length > 0 ? 0 : Math.max(0, Math.min(100, raw));

  if (hard.length > 0) reasons.push(...hard);
  if (day.pop !== null && day.pop > 50) reasons.push("降水概率较高");
  if (day.text === null || day.aqi === null || day.windScale === null) reasons.push("部分天气数据缺失，按保守估计");

  const conclusion: WeatherConclusion =
    hard.length > 0 ? "indoor"
      : score >= 75 ? "outdoor"
        : score >= 55 ? "outdoor_timed"
          : score >= 35 ? "indoor_preferred"
            : "indoor";

  return { score, conclusion, hardBlock: hard.length > 0, reasons };
}

/** 无缓存且请求失败时使用的全天室内占位天气：页面不空白，计划全按室内生成。 */
export function indoorFallbackDay(date: string): WeatherDay {
  return {
    date,
    tempMax: 20,
    tempMin: 15,
    pop: 80,
    windScale: 4,
    text: "天气数据不可用",
    aqi: 120,
    humidity: 75,
    uvIndex: 6,
  };
}

/** 判断缓存是否仍在 60 分钟 TTL 内（SRS 9.3）。 */
export function cacheFresh(fetchedAtIso: string, now: Date = new Date()): boolean {
  const t = new Date(fetchedAtIso).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < 60 * 60 * 1000;
}

/** 夏季/冬季推荐时段（V0.3 4.3）；供计划理由使用。 */
export function preferredOutdoorWindow(month: number): string {
  return month >= 5 && month <= 9 ? "6:00–9:00 或 18:00 后" : "10:00–16:00";
}
