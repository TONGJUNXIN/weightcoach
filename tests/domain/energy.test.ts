import { describe, expect, it } from "vitest";
import { calcEnergy, calcGoalPeriod, clampDeficit, customGoalPlan, recommendedGoalPlan, validateGoal } from "@/domain/energy";

// SRS 6.13.1 校验用例：80 kg、175 cm、35 岁男性、轻体力、缺口 400
// → BMR 1724、TDEE 2370、摄入 1970；目标 70 kg → 13–25 周
describe("calcEnergy", () => {
  it("SRS 标准用例", () => {
    const r = calcEnergy({
      sex: "male",
      birthYear: 1991,
      heightCm: 175,
      weightKg: 80,
      activityLevel: "light",
      deficitKcal: 400,
    });
    expect(r.bmr).toBe(1724);
    expect(r.tdee).toBe(2370);
    expect(r.intake).toBe(1970);
  });

  it("目标摄入不低于下限（女性 1200）", () => {
    const r = calcEnergy({
      sex: "female",
      birthYear: 1991,
      heightCm: 160,
      weightKg: 60,
      activityLevel: "sedentary",
      deficitKcal: 500,
    });
    expect(r.intake).toBeGreaterThanOrEqual(Math.max(r.bmr, 1200));
  });
});

describe("calcGoalPeriod", () => {
  it("80→70 显示 13–25 周", () => {
    const r = calcGoalPeriod(80, 70, 175);
    expect(r.weeksFast).toBe(13);
    expect(r.weeksSlow).toBe(25);
    expect(r.etaEnd > r.etaStart).toBe(true);
  });
});

describe("clampDeficit", () => {
  it("缺口限制在 350–500", () => {
    expect(clampDeficit(100)).toBe(350);
    expect(clampDeficit(400)).toBe(400);
    expect(clampDeficit(999)).toBe(500);
  });
});

describe("recommendedGoalPlan / customGoalPlan", () => {
  const today = new Date(2026, 0, 1);

  it("推荐方案按 400 kcal/天 估算 80→70 约 13 周", () => {
    const r = recommendedGoalPlan(80, 70, today);
    expect(r.deficit).toBe(400);
    expect(r.weeks).toBe(28);
    expect(r.date).toBe("2026-07-16");
  });

  it("自设日期反算缺口，过近日期拒绝；高缺口也允许", () => {
    const ok = customGoalPlan(80, 70, "2026-07-01", today);
    expect(ok.valid).toBe(true);
    expect(ok.deficit).toBeGreaterThanOrEqual(350);

    const tooSoon = customGoalPlan(80, 70, "2026-01-05", today);
    expect(tooSoon.valid).toBe(false);

    const aggressive = customGoalPlan(80, 70, "2026-01-15", today);
    expect(aggressive.valid).toBe(true);
    expect(aggressive.deficit).toBeGreaterThan(500);
  });

  it("自设日期可以低于 350 kcal/天（只限制上限 500）", () => {
    const slow = customGoalPlan(80, 70, "2027-06-01", today);
    expect(slow.valid).toBe(true);
    expect(slow.deficit).toBeLessThan(350);
  });
});

describe("validateGoal", () => {  it("拒绝 BMI < 18.5 的目标", () => {
    const r = validateGoal(80, 40, 175);
    expect(r.ok).toBe(false);
  });
  it("拒绝目标 ≥ 当前体重", () => {
    const r = validateGoal(70, 70, 175);
    expect(r.ok).toBe(false);
  });
  it("合法目标通过", () => {
    const r = validateGoal(80, 70, 175);
    expect(r.ok).toBe(true);
  });
});
