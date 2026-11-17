import { describe, expect, it } from "vitest";
import {
  ChatSchema, DietSchema, localDiet, localReview, PdfSchema, ReviewSchema, stripJsonFence,
  validateOutput, type ReviewOutput,
} from "@/domain/aiSchemas";
import type { WeekReport } from "@/domain/review";

const validReview = {
  week_summary: { weight: "体重持平", waist: "腰围下降", exercise: "运动3天", medication: "依从100%", indicators: "LDL下降" },
  highlights: ["坚持记录"],
  concerns: [{ level: "info", text: "样本偏少" }],
  next_week: { exercise_focus: "快走", diet_focus: "限钠", tips: ["早睡"] },
  questions: ["最近睡眠如何？"],
  disclaimer: "非医疗建议",
};

describe("validateOutput（FR-AI-05 / 附录 B）", () => {
  it("合法周复盘 JSON 通过", () => {
    const r = validateOutput<ReviewOutput>("review", JSON.stringify(validReview));
    expect(r.ok).toBe(true);
    expect(r.data?.highlights).toHaveLength(1);
  });

  it("去除 ```json 代码块后解析", () => {
    expect(stripJsonFence("```json\n{\"answer\":\"好的\"}\n```")).toBe('{"answer":"好的"}');
    const r = validateOutput("chat", "```json\n{\"answer\":\"好的\"}\n```");
    expect(r.ok).toBe(true);
  });

  it("非法 JSON 直接失败", () => {
    expect(validateOutput("review", "not json").ok).toBe(false);
  });

  it("违反约束（concerns 超 3 条 / level 非枚举）失败", () => {
    const bad = { ...validReview, concerns: Array.from({ length: 4 }, () => ({ level: "info", text: "x" })) };
    expect(validateOutput("review", JSON.stringify(bad)).ok).toBe(false);
    const badLevel = { ...validReview, concerns: [{ level: "danger", text: "x" }] };
    expect(validateOutput("review", JSON.stringify(badLevel)).ok).toBe(false);
  });

  it("饮食 schema：daily_targets 必须正数、meals 3-5、swaps≥4", () => {
    const base = {
      daily_targets: { energy: 1900, proteinG: 90, fatG: 60, carbG: 220 },
      meals: [{ name: "早餐", foods: "燕麦牛奶" }, { name: "午餐", foods: "米饭青菜" }, { name: "晚餐", foods: "鱼虾蔬菜" }],
      swaps: [
        { category: "主食", options: "糙米/燕麦" }, { category: "蛋白", options: "鱼/豆腐" },
        { category: "蔬菜", options: "绿叶/菌菇" }, { category: "油脂", options: "橄榄油/菜籽油" },
      ],
    };
    expect(DietSchema.safeParse(base).success).toBe(true);
    const neg = { ...base, daily_targets: { ...base.daily_targets, energy: -1 } };
    expect(DietSchema.safeParse(neg).success).toBe(false);
    const fewSwaps = { ...base, swaps: base.swaps.slice(0, 3) };
    expect(DietSchema.safeParse(fewSwaps).success).toBe(false);
  });

  it("PDF schema：confidence 必须 0-1，name/value/unit 必填", () => {
    expect(PdfSchema.safeParse({ indicators: [{ name: "LDL", value: 3.1, unit: "mmol/L", confidence: 0.9 }] }).success).toBe(true);
    expect(PdfSchema.safeParse({ indicators: [{ name: "LDL", value: 3.1, unit: "mmol/L", confidence: 1.5 }] }).success).toBe(false);
    expect(PdfSchema.safeParse({ indicators: [{ value: 3.1, unit: "mmol/L", confidence: 0.5 }] }).success).toBe(false);
  });

  it("自由问答 schema 要求非空答案", () => {
    expect(ChatSchema.safeParse({ answer: "建议就医" }).success).toBe(true);
    expect(ChatSchema.safeParse({ answer: "" }).success).toBe(false);
  });
});

describe("本地降级模板（source=local）", () => {
  const report: WeekReport = {
    weekStart: "2026-11-09", weekEnd: "2026-11-15",
    weightAvg: 79.4, weightPrev: 79.7, weightChange: -0.3,
    waistLatest: 92, waistChange: -1, exerciseDays: 3, planSessions: 4,
    adherenceTaken: 6, adherenceDue: 7, adherenceRate: 86,
    indicatorChanges: [{ name: "LDL-C", unit: "mmol/L", from: 3.3, to: 3.1, delta: -0.2, fromDate: "2026-11-10", toDate: "2026-11-14" }],
    loggingRate: 86, weightRecordDays: 6, insufficientData: false,
  };

  it("降级模板仍通过 schema（保证非法 JSON 后可用）", () => {
    const local = localReview(report);
    expect(ReviewSchema.safeParse(local).success).toBe(true);
  });

  it("样本不足时 concerns 给出 info 而非编造趋势", () => {
    const local = localReview({ ...report, insufficientData: true });
    expect(local.concerns[0]?.level).toBe("info");
    expect(local.highlights).toHaveLength(0);
  });

  it("本地饮食降级模板通过 DietSchema（4 餐/4 类替换/正数目标）", () => {
    const local = localDiet({ energy: 1900, proteinG: 90, fatG: 58, carbG: 220 });
    expect(DietSchema.safeParse(local).success).toBe(true);
  });
});
