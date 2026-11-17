/**
 * AI 结构化输出的 Zod 校验与本地降级模板（SRS FR-AI-05 / 附录 B / 9.5）。
 * 流程：模型返回 → Zod 校验 → 失败修复 1 次 → 仍失败用本地模板并标注 source=local。
 * 所有 schema 严格按附录 B 校验要点：字段必填、数组上限、字数上限。
 */
import { z } from "zod";
import type { TaskId } from "./ai";
import type { WeekReport } from "./review";

// ——— 周复盘 schema（附录 B：五字段非空≤80字；highlights 0-3≤40；concerns 0-3枚举；next_week；questions 0-2） ———
const weekSummary = z.object({
  weight: z.string().min(1).max(80),
  waist: z.string().min(1).max(80),
  exercise: z.string().min(1).max(80),
  medication: z.string().min(1).max(80),
  indicators: z.string().min(1).max(80),
});
const concern = z.object({
  level: z.enum(["info", "warn", "alert"]),
  text: z.string().min(1).max(60),
});
export const ReviewSchema = z.object({
  week_summary: weekSummary,
  highlights: z.array(z.string().max(40)).max(3).default([]),
  concerns: z.array(concern).max(3).default([]),
  next_week: z.object({
    exercise_focus: z.string().max(80).default(""),
    diet_focus: z.string().max(80).default(""),
    tips: z.array(z.string().max(40)).max(3).default([]),
  }).default({ exercise_focus: "", diet_focus: "", tips: [] }),
  questions: z.array(z.string().max(40)).max(2).default([]),
  disclaimer: z.string().default("本内容为生活方式建议，不构成医疗诊断。"),
});
export type ReviewOutput = z.infer<typeof ReviewSchema>;

// ——— 饮食建议 schema（附录 B：daily_targets 四项正数；meals 3-5；swaps ≥4 类） ———
const meal = z.object({
  name: z.string().min(1),
  foods: z.string().min(1),
  note: z.string().optional(),
});
const swap = z.object({ category: z.string().min(1), options: z.string().min(1) });
export const DietSchema = z.object({
  daily_targets: z.object({
    energy: z.number().positive(),
    proteinG: z.number().positive(),
    fatG: z.number().positive(),
    carbG: z.number().positive(),
  }),
  meals: z.array(meal).min(3).max(5),
  swaps: z.array(swap).min(4),
  eating_out: z.array(z.string()).default([]),
  disclaimer: z.string().default("估算值，不承诺疗效；有疾病或用药请遵医嘱。"),
});
export type DietOutput = z.infer<typeof DietSchema>;

// ——— PDF 解析 schema（附录 B：每项 name/value/unit 必填；confidence 0-1） ———
const conf = z.number().min(0).max(1);
export const PdfSchema = z.object({
  indicators: z.array(z.object({
    name: z.string().min(1),
    value: z.number(),
    unit: z.string().min(1),
    measured_on: z.string().nullable().optional(),
    confidence: conf,
  })).default([]),
  diseases: z.array(z.object({ name: z.string().min(1), confidence: conf })).default([]),
  medications: z.array(z.object({
    name: z.string().min(1),
    dose: z.string().default(""),
    dose_unit: z.string().default(""),
    confidence: conf,
  })).default([]),
});
export type PdfOutput = z.infer<typeof PdfSchema>;

// ——— 计划理由 / 平台期归因（一句话解释，轻量 schema） ———
export const ReasonSchema = z.object({
  text: z.string().min(1).max(200),
});
export type ReasonOutput = z.infer<typeof ReasonSchema>;

// ——— 自由问答（ FR-AI-04：文本回答，不强制结构，但保持 "answer" 字段便于统一渲染） ———
export const ChatSchema = z.object({
  answer: z.string().min(1),
});
export type ChatOutput = z.infer<typeof ChatSchema>;

/** 按任务取对应 schema（jsonMode 任务才需要） */
export function schemaForTask(task: TaskId): z.ZodTypeAny {
  switch (task) {
    case "review": return ReviewSchema;
    case "diet": return DietSchema;
    case "pdf": return PdfSchema;
    case "planReason":
    case "plateau": return ReasonSchema;
    case "chat": return ChatSchema;
  }
}

/** 从模型可能包裹的 ```json ... ``` 代码块中提取 JSON；失败返回原串 */
export function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? (m[1] ?? trimmed) : trimmed;
}

export interface ValidateResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** 校验模型输出：去代码块 → parse → schema.safeParse */
export function validateOutput<T>(task: TaskId, raw: string): ValidateResult<T> {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
    const result = schemaForTask(task).safeParse(parsed);
    if (result.success) return { ok: true, data: result.data as T };
    return { ok: false, error: result.error.issues.map((i) => i.path.join(".") || "root").join(",") };
  } catch {
    return { ok: false, error: "JSON 解析失败" };
  }
}

// ——————————————————— 本地降级模板（source=local） ———————————————————

/** 用已聚合的周报生成"事实陈述"本地总结（与 summarizeWeek 同源，不判断好坏） */
export function localReview(report: WeekReport, disclaimer = "本内容为生活方式建议，不构成医疗诊断。"): ReviewOutput {
  const s = (v: string) => v.slice(0, 80) || "暂无数据";
  return {
    week_summary: {
      weight: s(report.weightChange == null ? "本周体重暂无可比数据。" : `体重均值 ${report.weightAvg} kg，较上周变化 ${report.weightChange} kg。`),
      waist: s(report.waistChange == null ? "腰围暂无可比数据。" : `最近腰围 ${report.waistLatest} cm，与 4 周前相比变化 ${report.waistChange} cm。`),
      exercise: s(`运动 ${report.exerciseDays} 天，计划 ${report.planSessions} 项。`),
      medication: s(`用药打卡 ${report.adherenceTaken}/${report.adherenceDue} 时段（${report.adherenceRate}%）。`),
      indicators: s(report.indicatorChanges.length
        ? report.indicatorChanges.map((c) => `${c.name} ${c.from}→${c.to} ${c.unit}`).join("；")
        : "本周暂无可比指标。"),
    },
    highlights: report.insufficientData ? [] : [`记录完成率 ${report.loggingRate}%。`],
    concerns: report.insufficientData ? [{ level: "info", text: "本周记录不足，趋势仅供参考。" }] : [],
    next_week: { exercise_focus: "", diet_focus: "", tips: [] },
    questions: [],
    disclaimer,
  };
}

/** 本地计划理由：不含热量数字，不推断 */
export function localReason(fallbackText: string): ReasonOutput {
  return { text: fallbackText.slice(0, 200) };
}

/** 本地自由问答降级：不臆测数据，只给出设置引导 */
export function localChatAnswer(): ChatOutput {
  return { answer: "这次没拿到结果，请稍后重试；如需数据解读，请确认网络或检查 AI 设置。" };
}

/** 本地饮食降级提示：调用方已有本地规则生成的饮食建议，这里只返回占位说明 */
export function localDietDisclaimer(): string {
  return "已使用本地规则生成的建议；AI 服务暂不可用。估算值，不承诺疗效；有疾病或用药请遵医嘱。";
}

/** 本地饮食降级模板（source=local）：用已算好的目标生成符合 DietSchema 的建议 */
export function localDiet(targets: { energy: number; proteinG: number; fatG: number; carbG: number }): DietOutput {
  return {
    daily_targets: {
      energy: targets.energy,
      proteinG: targets.proteinG,
      fatG: targets.fatG,
      carbG: targets.carbG,
    },
    meals: [
      { name: "早餐", foods: "燕麦 50 g + 牛奶 250 ml + 鸡蛋 1 个", note: "约 30%" },
      { name: "午餐", foods: "杂粮饭 200 g + 鸡胸/鱼 150 g + 绿叶菜 200 g", note: "约 35%" },
      { name: "加餐", foods: "无糖酸奶 100 g 或一小把坚果", note: "约 5%" },
      { name: "晚餐", foods: "杂粮饭 150 g + 豆腐/鱼 150 g + 蔬菜 200 g", note: "约 30%" },
    ],
    swaps: [
      { category: "主食", options: "糙米 / 燕麦 / 红薯（等份替换）" },
      { category: "蛋白", options: "鸡胸 / 鱼虾 / 豆腐（等份替换）" },
      { category: "蔬菜", options: "绿叶菜 / 菌菇 / 瓜类（等份替换）" },
      { category: "油脂", options: "橄榄油 / 菜籽油（等份替换）" },
    ],
    eating_out: ["优先蒸煮炖，少油炸", "酱汁另放，主食减半", "不喝含糖饮料"],
    disclaimer: localDietDisclaimer(),
  };
}
