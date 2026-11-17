/**
 * 周计划生成（SRS 6.13.2，纯函数）。
 * 规则：3–5 次、150–300 分钟、2 次力量、≥1 天休息、高强度间隔 ≥48h；
 * 按膝/腰/心肺禁忌过滤动作；按天气评分决定户外/室内；不计算、不输出任何热量数字。
 */
import { parseDate } from "@/lib/date";
import type { WeatherScore, WeatherConclusion } from "./weather";

export type Constraint = "knee" | "waist" | "cardio";
export type PlanIntensity = "low" | "medium" | "high";
export type PlanPlace = "outdoor" | "indoor";
export type ActionGroup =
  | "cardio" | "strength_upper" | "strength_lower" | "strength_core" | "mobility" | "rest";

export interface ExerciseAction {
  mode: string;
  group: ActionGroup;
  intensity: PlanIntensity;
  places: PlanPlace[];
  /** 触犯任一禁忌即过滤 */
  bannedBy: Constraint[];
  /** 跑跳类：膝禁忌一并过滤 */
  jump?: boolean;
}

export const EXERCISE_ACTIONS: ExerciseAction[] = [
  { mode: "快走", group: "cardio", intensity: "low", places: ["outdoor", "indoor"], bannedBy: [] },
  { mode: "慢跑", group: "cardio", intensity: "medium", places: ["outdoor"], bannedBy: [], jump: true },
  { mode: "骑行", group: "cardio", intensity: "medium", places: ["outdoor"], bannedBy: [] },
  { mode: "游泳", group: "cardio", intensity: "medium", places: ["indoor"], bannedBy: [] },
  { mode: "椭圆机", group: "cardio", intensity: "medium", places: ["indoor"], bannedBy: [] },
  { mode: "跳绳", group: "cardio", intensity: "high", places: ["indoor"], bannedBy: ["knee"], jump: true },
  { mode: "爬楼", group: "cardio", intensity: "high", places: ["indoor", "outdoor"], bannedBy: ["knee"], jump: true },
  { mode: "力量·上肢", group: "strength_upper", intensity: "medium", places: ["indoor"], bannedBy: [] },
  { mode: "力量·下肢", group: "strength_lower", intensity: "medium", places: ["indoor"], bannedBy: ["knee"] },
  { mode: "力量·核心", group: "strength_core", intensity: "medium", places: ["indoor"], bannedBy: ["waist"] },
  { mode: "瑜伽拉伸", group: "mobility", intensity: "low", places: ["indoor"], bannedBy: [] },
  { mode: "休息", group: "rest", intensity: "low", places: ["indoor", "outdoor"], bannedBy: [] },
];

export function actionForMode(mode: string): ExerciseAction | undefined {
  return EXERCISE_ACTIONS.find((a) => a.mode === mode);
}

/** 按禁忌过滤动作；心肺禁忌把强度上限压到中等（去除高强度间歇、憋气动作）。 */
export function availableActions(constraints: Constraint[]): ExerciseAction[] {
  return EXERCISE_ACTIONS.filter((a) => {
    if (a.bannedBy.some((c) => constraints.includes(c))) return false;
    if (constraints.includes("knee") && a.jump) return false;
    return true;
  }).map((a) => {
    if (constraints.includes("cardio") && a.intensity === "high") {
      const alternative = EXERCISE_ACTIONS.find(
        (x) => x.group === a.group && x.intensity === "medium" && !x.bannedBy.some((c) => constraints.includes(c)),
      );
      return alternative ?? { ...a, intensity: "medium" as const };
    }
    return a;
  });
}

export interface PlanItem {
  date: string;
  mode: string;
  minutes: number;
  intensity: PlanIntensity;
  place: PlanPlace;
  reason: string;
}

export interface PlanInput {
  weekStart: string; // 周一 YYYY-MM-DD
  days: Array<{ date: string; score: WeatherScore }>;
  constraints: Constraint[];
  /** 默认工作日 20–40 min，周末 30–60 min */
  available?: { weekday: [number, number]; weekend: [number, number] };
  /** 用户锁定/替换/改期的项，优先保留 */
  locked?: PlanItem[];
}

export interface PlanResult {
  items: PlanItem[];
  sessions: number;
  totalMinutes: number;
  strength: number;
  restDays: number;
  valid: boolean;
  issues: string[];
}

const DEFAULT_AVAILABLE = { weekday: [20, 40] as [number, number], weekend: [30, 60] as [number, number] };

function isWeekend(date: string): boolean {
  const d = parseDate(date).getDay();
  return d === 0 || d === 6;
}

function minutesFor(date: string, available: PlanInput["available"]): number {
  const range = isWeekend(date) ? (available?.weekend ?? DEFAULT_AVAILABLE.weekend)
    : (available?.weekday ?? DEFAULT_AVAILABLE.weekday);
  const preferred = isWeekend(date) ? 45 : 30;
  return Math.min(range[1], Math.max(range[0], preferred));
}

function placeFor(conclusion: WeatherConclusion, hardBlock: boolean): PlanPlace {
  if (hardBlock || conclusion === "indoor" || conclusion === "indoor_preferred") return "indoor";
  return "outdoor";
}

function reasonFor(date: string, score: WeatherScore, action: ExerciseAction, place: PlanPlace, constraints: Constraint[]): string {
  const bits: string[] = [];
  if (score.hardBlock) {
    bits.push("天气不适合户外");
  } else if (score.conclusion === "outdoor") {
    bits.push(`天气适宜（${score.score} 分）`);
  } else if (score.conclusion === "outdoor_timed") {
    const month = parseDate(date).getMonth() + 1;
    bits.push(`可户外但需择时（${month >= 5 && month <= 9 ? "6:00–9:00 或 18:00 后" : "10:00–16:00"}）`);
  } else {
    bits.push(`室外条件一般（${score.score} 分）`);
  }
  if (place === "indoor" && !score.hardBlock && score.conclusion !== "indoor" && score.conclusion !== "indoor_preferred") {
    bits.push("受运动禁忌限制，选室内动作");
  }
  if (constraints.includes("knee") && action.jump === false && action.group === "cardio" && action.mode !== "快走") {
    bits.push("避开跑跳类动作");
  }
  bits.push(`${place === "outdoor" ? "户外" : "室内"}${action.mode}`);
  return `${bits.join("，")}`;
}

const FALLBACK_ACTION: ExerciseAction = {
  mode: "瑜伽拉伸", group: "mobility", intensity: "low", places: ["indoor"], bannedBy: [],
};

function pickCardio(actions: ExerciseAction[], place: PlanPlace): ExerciseAction {
  const pool = actions.filter((a) => a.group === "cardio" && a.places.includes(place));
  const order = ["快走", "椭圆机", "游泳", "骑行", "慢跑", "跳绳", "爬楼"];
  const ranked = [...pool].sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode));
  return ranked[0] ?? actions.find((a) => a.mode === "瑜伽拉伸") ?? FALLBACK_ACTION;
}

function pickStrength(actions: ExerciseAction[], index: number): ExerciseAction {
  const pool = actions.filter((a) => a.group.startsWith("strength_"));
  return pool[index % Math.max(1, pool.length)] ?? actions.find((a) => a.mode === "瑜伽拉伸") ?? FALLBACK_ACTION;
}

/**
 * 生成一周计划。输入 7 天（不足 7 天按实际天数），按天气评分挑休息/力量/有氧日。
 * 生成结果不含任何热量字段。
 */
export function generateWeekPlan(input: PlanInput): PlanResult {
  const { days, constraints, locked = [] } = input;
  const actions = availableActions(constraints);
  const lockedByDate = new Map(locked.map((item) => [item.date, item]));
  const free = days.filter((d) => !lockedByDate.has(d.date));
  const byScore = [...free].sort((a, b) => b.score.score - a.score.score || a.date.localeCompare(b.date));

  // 至少留 1 天休息；7 天满时留 2 天（保证 5 次训练）
  const restCount = days.length >= 7 ? 2 : 1;
  const restDates = new Set(byScore.slice(-restCount).map((d) => d.date));
  const trainable = byScore.filter((d) => !restDates.has(d.date));

  // 先排 2 次力量（不同肌群轮换），其余填有氧；工作日短、周末长
  const targetSessions = Math.min(5, days.length - restCount + locked.length);
  const autoCount = Math.max(0, targetSessions - locked.length);
  const chosen = trainable.slice(0, autoCount);
  const items: PlanItem[] = [...locked];

  chosen.forEach((day, index) => {
    const wantStrength = index < 2;
    const action = wantStrength ? pickStrength(actions, index) : pickCardio(actions, placeFor(day.score.conclusion, day.score.hardBlock));
    const place = wantStrength ? "indoor" : placeFor(day.score.conclusion, day.score.hardBlock);
    const actual = actions.find((a) => a.mode === action.mode && a.places.includes(place)) ?? action;
    items.push({
      date: day.date,
      mode: actual.mode,
      minutes: minutesFor(day.date, input.available),
      intensity: actual.intensity,
      place,
      reason: reasonFor(day.date, day.score, actual, place, constraints),
    });
  });

  restDates.forEach((date) => {
    if (lockedByDate.has(date)) return;
    const day = days.find((d) => d.date === date);
    if (!day) return;
    items.push({
      date,
      mode: "休息",
      minutes: 0,
      intensity: "low",
      place: "indoor",
      reason: day.score.hardBlock ? "天气不适合户外，安排休息" : `适宜度 ${day.score.score} 分，安排恢复`,
    });
  });

  const sorted = items.sort((a, b) => a.date.localeCompare(b.date));
  adjustMinutes(sorted, input.available);

  const sessions = sorted.filter((i) => i.mode !== "休息").length;
  const totalMinutes = sorted.reduce((sum, i) => sum + i.minutes, 0);
  const strength = sorted.filter((i) => (actionForMode(i.mode)?.group ?? "").startsWith("strength_")).length;
  const restDays = sorted.filter((i) => i.mode === "休息").length;
  const validation = validatePlan(sorted);
  return {
    items: sorted,
    sessions,
    totalMinutes,
    strength,
    restDays,
    valid: validation.ok,
    issues: validation.issues,
  };
}

/** 把总时长收敛到 150–300 分钟，同时不越出用户可用时间。 */
function adjustMinutes(items: PlanItem[], available: PlanInput["available"]): void {
  const rangeFor = (date: string) => isWeekend(date)
    ? (available?.weekend ?? DEFAULT_AVAILABLE.weekend)
    : (available?.weekday ?? DEFAULT_AVAILABLE.weekday);
  const training = items.filter((i) => i.mode !== "休息").sort((a, b) => b.minutes - a.minutes);
  let total = training.reduce((s, i) => s + i.minutes, 0);
  for (let i = 0; total < 150 && i < training.length * 4; i++) {
    const item = training[i % training.length];
    if (!item) break;
    const max = rangeFor(item.date)[1];
    if (item.minutes < max) { item.minutes += 5; total += 5; }
  }
  for (let i = 0; total > 300 && i < training.length * 12; i++) {
    const item = training[i % training.length];
    if (!item) break;
    const min = rangeFor(item.date)[0];
    if (item.minutes > min) { item.minutes -= 5; total -= 5; }
  }
}

/** 规则校验（FR-PLN-04/05/06、AC-22/23）。 */
export function validatePlan(items: PlanItem[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const sessions = items.filter((i) => i.mode !== "休息").length;
  const minutes = items.reduce((s, i) => s + i.minutes, 0);
  const strength = items.filter((i) => (actionForMode(i.mode)?.group ?? "").startsWith("strength_")).length;
  const rest = items.filter((i) => i.mode === "休息").length;

  if (sessions < 3) issues.push(`训练次数 ${sessions}，需 3–5 次`);
  if (sessions > 5) issues.push(`训练次数 ${sessions}，需 3–5 次`);
  if (minutes < 150) issues.push(`总时长 ${minutes} 分钟，需 150–300 分钟`);
  if (minutes > 300) issues.push(`总时长 ${minutes} 分钟，需 150–300 分钟`);
  if (strength < 2) issues.push(`力量 ${strength} 次，需 2 次`);
  if (rest < 1) issues.push("至少留 1 天休息");

  const highDates = items
    .filter((i) => i.intensity === "high")
    .map((i) => parseDate(i.date).getTime())
    .sort((a, b) => a - b);
  for (let i = 1; i < highDates.length; i++) {
    const current = highDates[i];
    const previous = highDates[i - 1];
    if (current !== undefined && previous !== undefined && current - previous < 48 * 3600_000) {
      issues.push("高强度安排间隔不足 48 小时");
      break;
    }
  }
  return { ok: issues.length === 0, issues };
}

/** 检查计划中是否含有被禁忌过滤的动作（AC-22）。 */
export function hasForbiddenAction(items: PlanItem[], constraints: Constraint[]): boolean {
  const allowed = new Set(availableActions(constraints).map((a) => a.mode));
  return items.some((i) => !allowed.has(i.mode));
}
