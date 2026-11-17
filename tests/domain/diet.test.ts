import { describe, expect, it } from "vitest";
import {
  calcDietTargets, DIET_DISCLAIMER, diseaseConstraints, EATING_OUT_TIPS,
  mealSplit, shoppingList, SWAP_GROUPS,
} from "@/domain/diet";

describe("饮食目标（V0.3 4.4 / SRS 6.13.1）", () => {
  it("1970 kcal、目标 70 kg 的三大营养素落在示例区间", () => {
    const t = calcDietTargets(1970, 70);
    expect(t.proteinG).toBe(98);
    expect(t.proteinRange).toEqual([84, 112]);
    expect(t.fatG).toBe(60);
    expect(t.fatRange).toEqual([55, 66]);
    expect(t.carbG).toBeGreaterThanOrEqual(240);
    expect(t.carbG).toBeLessThanOrEqual(270);
    expect(t.sodiumMg).toBe(2000);
    expect(t.fiberG).toEqual([25, 30]);
    expect(t.waterMl).toEqual([1500, 2000]);
  });

  it("3 餐 + 1 加餐按 30/35/30/5 分配", () => {
    const t = calcDietTargets(1970, 70);
    const meals = mealSplit(t);
    expect(meals.map((m) => m.key)).toEqual(["breakfast", "lunch", "snack", "dinner"]);
    expect(meals.map((m) => m.ratio)).toEqual([0.3, 0.35, 0.05, 0.3]);
    expect(meals.reduce((s, m) => s + m.energy, 0)).toBe(t.energy);
    expect(meals.find((m) => m.key === "snack")?.energy).toBe(99);
  });

  it("四类等热量替换，每类至少 4 个选项并给份量", () => {
    expect(SWAP_GROUPS).toHaveLength(4);
    for (const group of SWAP_GROUPS) {
      expect(group.options.length).toBeGreaterThanOrEqual(4);
      expect(group.options.every((o) => o.portion.length > 0 && o.approxEnergy > 0)).toBe(true);
    }
  });

  it("购物清单与外食策略可用", () => {
    expect(shoppingList().length).toBeGreaterThanOrEqual(4);
    expect(EATING_OUT_TIPS.length).toBeGreaterThanOrEqual(5);
    expect(DIET_DISCLAIMER).toContain("估算值");
  });
});

describe("疾病饮食约束（V0.3 表 10，AC-24）", () => {
  it("高血压显示钠 <2000 mg", () => {
    const [c] = diseaseConstraints([{ name: "高血压", presetKey: "hypertension" }]);
    expect(c?.items.join(" ")).toContain("钠 <2000 mg");
  });

  it("按登记疾病叠加，未知疾病只给均衡建议", () => {
    const list = diseaseConstraints([
      { name: "高血压", presetKey: "hypertension" },
      { name: "高血脂", presetKey: "hyperlipidemia" },
      { name: "少见病", presetKey: null },
    ]);
    expect(list).toHaveLength(3);
    expect(list[1]?.items.join(" ")).toContain("饱和脂肪 <7%");
    expect(list[2]?.items.join(" ")).toContain("均衡饮食");
  });

  it("所有约束文案不出现诊断或疗效承诺", () => {
    const all = diseaseConstraints([
      { name: "高血压", presetKey: "hypertension" },
      { name: "2 型糖尿病", presetKey: "t2dm" },
      { name: "慢性肾病", presetKey: "ckd" },
      { name: "其他", presetKey: "other" },
    ]).flatMap((c) => c.items).join(" ");
    expect(all).not.toMatch(/诊断|治愈|疗效|处方/);
  });
});
