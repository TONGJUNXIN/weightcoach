import { describe, expect, it } from "vitest";
import { availableActions, generateWeekPlan, hasForbiddenAction, validatePlan, type PlanInput } from "@/domain/plan";
import type { WeatherConclusion, WeatherScore } from "@/domain/weather";

const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];

function score(n: number, hardBlock = false): WeatherScore {
  const conclusion: WeatherConclusion = hardBlock || n < 35 ? "indoor"
    : n < 55 ? "indoor_preferred"
      : n < 75 ? "outdoor_timed" : "outdoor";
  return { score: n, conclusion, hardBlock, reasons: [] };
}

function input(patch: Partial<PlanInput> = {}): PlanInput {
  return {
    weekStart: "2026-11-16",
    days: dates.map((date) => ({ date, score: score(85) })),
    constraints: [],
    ...patch,
  };
}

describe("周计划生成（SRS 6.13.2）", () => {
  it("7 天生成满足 3–5 次 / 150–300 分钟 / 2 次力量 / ≥1 天休息", () => {
    const result = generateWeekPlan(input());
    expect(result.sessions).toBeGreaterThanOrEqual(3);
    expect(result.sessions).toBeLessThanOrEqual(5);
    expect(result.totalMinutes).toBeGreaterThanOrEqual(150);
    expect(result.totalMinutes).toBeLessThanOrEqual(300);
    expect(result.strength).toBe(2);
    expect(result.restDays).toBeGreaterThanOrEqual(1);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.items).toHaveLength(7);
  });

  it("计划中不出现任何热量数字或字段", () => {
    const result = generateWeekPlan(input());
    const text = JSON.stringify(result.items);
    expect(text).not.toMatch(/kcal|大卡|热量|消耗/i);
    expect(result.items.every((i) => !("kcal" in i))).toBe(true);
  });

  it("膝禁忌：无跳绳、爬楼、跑跳，规则仍通过（AC-22）", () => {
    const result = generateWeekPlan(input({ constraints: ["knee"] }));
    expect(result.items.some((i) => ["跳绳", "爬楼", "慢跑"].includes(i.mode))).toBe(false);
    expect(hasForbiddenAction(result.items, ["knee"])).toBe(false);
    expect(result.valid).toBe(true);
  });

  it("腰禁忌：无力量核心等禁忌动作", () => {
    const result = generateWeekPlan(input({ constraints: ["waist"] }));
    expect(result.items.some((i) => i.mode === "力量·核心")).toBe(false);
    expect(hasForbiddenAction(result.items, ["waist"])).toBe(false);
  });

  it("心肺禁忌：强度上限中等", () => {
    const result = generateWeekPlan(input({ constraints: ["cardio"] }));
    expect(result.items.every((i) => i.intensity !== "high")).toBe(true);
    expect(availableActions(["cardio"]).every((a) => a.intensity !== "high")).toBe(true);
  });

  it("天气硬阻日一律不排户外", () => {
    const days = dates.map((date, idx) => ({ date, score: idx === 1 ? score(0, true) : score(85) }));
    const result = generateWeekPlan(input({ days }));
    const blocked = result.items.filter((i) => i.date === "2026-11-17");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.place).toBe("indoor");
  });

  it("锁定项被保留且不被覆盖", () => {
    const locked = [{ date: "2026-11-18", mode: "游泳", minutes: 40, intensity: "medium" as const, place: "indoor" as const, reason: "锁定" }];
    const result = generateWeekPlan(input({ locked }));
    expect(result.items.find((i) => i.date === "2026-11-18")).toEqual(locked[0]);
  });

  it("不足 7 天也能生成有效计划", () => {
    const days = dates.slice(0, 6).map((date) => ({ date, score: score(85) }));
    const result = generateWeekPlan(input({ days }));
    expect(result.valid).toBe(true);
    expect(result.items).toHaveLength(6);
  });
});

describe("规则校验", () => {
  it("拒绝次数不足、时长不足、无休息", () => {
    expect(validatePlan([
      { date: "2026-11-16", mode: "快走", minutes: 30, intensity: "low", place: "outdoor", reason: "" },
      { date: "2026-11-17", mode: "快走", minutes: 30, intensity: "low", place: "outdoor", reason: "" },
    ]).issues.join("")).toContain("3–5 次");
    expect(validatePlan([
      { date: "2026-11-16", mode: "力量·上肢", minutes: 50, intensity: "medium", place: "indoor", reason: "" },
      { date: "2026-11-17", mode: "力量·下肢", minutes: 50, intensity: "medium", place: "indoor", reason: "" },
      { date: "2026-11-18", mode: "快走", minutes: 40, intensity: "low", place: "outdoor", reason: "" },
      { date: "2026-11-19", mode: "休息", minutes: 0, intensity: "low", place: "indoor", reason: "" },
    ]).issues.join("")).toContain("150–300");
  });
});
