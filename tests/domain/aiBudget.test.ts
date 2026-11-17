import { describe, expect, it } from "vitest";
import {
  addCost, checkBudget, DEFAULT_MONTHLY_BUDGET, estimateCost, monthKey, resolvePrice, WARN_RATIO,
} from "@/domain/aiBudget";

describe("estimateCost（附录 D token 估算）", () => {
  it("按输入/输出分别计价并保留 6 位", () => {
    // 1000 in ×0.002 + 500 out ×0.008 = 0.002 + 0.004 = 0.006
    expect(estimateCost(1000, 500, 0.002, 0.008)).toBe(0.006);
    expect(estimateCost(0, 0, 0.002, 0.008)).toBe(0);
  });

  it("负数 token 归零，不产生负成本", () => {
    expect(estimateCost(-100, -50, 0.002, 0.008)).toBe(0);
  });
});

describe("checkBudget（FR-AI-07 80% 提示 / 100% 停自动）", () => {
  it("默认预算 5 元、阈值 0.8", () => {
    expect(DEFAULT_MONTHLY_BUDGET).toBe(5);
    expect(WARN_RATIO).toBe(0.8);
  });

  it("低于 80% 放行", () => {
    expect(checkBudget(3, 5).kind).toBe("ok");
    expect(checkBudget(3.9, 5).kind).toBe("ok");
  });

  it("达到 80% 进入 warn（仍可放行但提示）", () => {
    const v = checkBudget(4, 5);
    expect(v.kind).toBe("warn");
    expect(v.ratio).toBeCloseTo(0.8);
  });

  it("达到 100% blocked（自动停，手动需确认）", () => {
    expect(checkBudget(5, 5).kind).toBe("blocked");
    expect(checkBudget(6, 5).kind).toBe("blocked");
  });

  it("预算<=0 时使用默认预算，不除零", () => {
    expect(checkBudget(3, 0).kind).toBe("ok");
    expect(checkBudget(5, -1).kind).toBe("blocked");
  });
});

describe("monthKey / addCost", () => {
  it("本地月份键 YYYY-MM", () => {
    expect(monthKey(new Date(2026, 10, 16))).toBe("2026-11");
    expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01");
  });
  it("累加成本保留 6 位，不漂移", () => {
    expect(addCost(0.006, 0.004)).toBe(0.01);
    expect(addCost(0.1, 0.2)).toBe(0.3);
  });
});

describe("resolvePrice（P0-2 缺省单价不能当 0）", () => {
  it("null / 空串回退默认价，避免 Number(null)=0", () => {
    expect(resolvePrice(null, 0.002)).toBe(0.002);
    expect(resolvePrice(undefined, 0.008)).toBe(0.008);
    expect(resolvePrice("", 0.002)).toBe(0.002);
    expect(resolvePrice("   ", 0.002)).toBe(0.002);
  });

  it("合法值保留，非法/负数回退", () => {
    expect(resolvePrice("0.003", 0.002)).toBe(0.003);
    expect(resolvePrice("0", 0.002)).toBe(0);
    expect(resolvePrice("abc", 0.002)).toBe(0.002);
    expect(resolvePrice("-1", 0.002)).toBe(0.002);
  });
});
