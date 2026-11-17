import { describe, expect, it } from "vitest";
import { cacheFresh, indoorFallbackDay, weatherScore, type WeatherDay } from "@/domain/weather";

const base: WeatherDay = {
  date: "2026-11-16",
  tempMax: 20,
  tempMin: 12,
  pop: 10,
  windScale: 3,
  text: "晴",
  aqi: 50,
  humidity: 60,
  uvIndex: 5,
};

describe("weatherScore（SRS 6.13.3 / V0.3 表 9）", () => {
  it("理想天气 100 分，结论户外", () => {
    const r = weatherScore(base);
    expect(r.score).toBe(100);
    expect(r.conclusion).toBe("outdoor");
    expect(r.hardBlock).toBe(false);
  });

  it("权重按 35/25/20/10/5/5 计算", () => {
    // temp 27℃→80，rain 40%→55，aqi 120→45，wind 4→80，humidity 82→50，uv 9→50
    const r = weatherScore({ ...base, tempMax: 27, pop: 40, aqi: 120, windScale: 4, humidity: 82, uvIndex: 9 });
    // 0.35×80 + 0.25×55 + 0.2×45 + 0.1×80 + 0.05×50 + 0.05×50 = 63.75 → 64
    expect(r.score).toBe(64);
  });

  it("结论分档：可户外需择时", () => {
    const r = weatherScore({ ...base, tempMax: 29, pop: 40, aqi: 120, windScale: 4, humidity: 60, uvIndex: 5 });
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.score).toBeLessThan(75);
    expect(r.conclusion).toBe("outdoor_timed");
  });

  it("结论分档：室内优先", () => {
    const r = weatherScore({ ...base, tempMax: 30, pop: 40, aqi: 120, windScale: 5, humidity: 82, uvIndex: 9 });
    expect(r.conclusion).toBe("indoor_preferred");
  });

  it("结论分档：不建议户外", () => {
    const r = weatherScore({ ...base, tempMax: 32, pop: 60, aqi: 180, windScale: 6, humidity: 90, uvIndex: 11 });
    expect(r.conclusion).toBe("indoor");
  });

  it.each([
    ["雷暴", { text: "雷暴" }],
    ["空气质量 >200", { aqi: 201 }],
    ["高温 ≥35℃", { tempMax: 35 }],
    ["低温 ≤−5℃", { tempMax: -5 }],
    ["风力 ≥7 级", { windScale: 7 }],
  ])("硬规则 %s 一律 0 分不排户外", (_label, patch) => {
    const r = weatherScore({ ...base, ...patch });
    expect(r.score).toBe(0);
    expect(r.hardBlock).toBe(true);
    expect(r.conclusion).toBe("indoor");
  });

  it("缺失数据按保守中性分，不误判为宜户外", () => {
    const r = weatherScore({ ...base, aqi: null, windScale: null, text: null });
    expect(r.score).toBeLessThan(100);
    expect(r.reasons.join("")).toContain("缺失");
  });
});

describe("天气缓存", () => {
  it("60 分钟内视为新鲜，超时视为过期", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(cacheFresh("2026-11-16T11:30:00Z", now)).toBe(true);
    expect(cacheFresh("2026-11-16T10:00:00Z", now)).toBe(false);
    expect(cacheFresh("not-a-date", now)).toBe(false);
  });

  it("无缓存兜底日按室内处理", () => {
    const day = indoorFallbackDay("2026-11-16");
    expect(weatherScore(day).conclusion).toBe("indoor");
  });
});
