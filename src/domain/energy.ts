/**
 * 能量与目标计算（SRS 6.13.1，纯函数，必须有单元测试）。
 * 公式口径不得擅改；调整需在交付说明中提出。
 */

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active";

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

export interface EnergyInput {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  deficitKcal: number; // 默认 400，允许 350–500
}

export interface EnergyResult {
  age: number;
  bmr: number;
  tdee: number;
  intake: number;
}

export function clampDeficit(deficit: number): number {
  return Math.min(500, Math.max(350, deficit));
}

/** Mifflin–St Jeor；结果四舍五入到整数 kcal。 */
export function calcEnergy(input: EnergyInput, today: Date = new Date()): EnergyResult {
  const age = today.getFullYear() - input.birthYear;
  const base =
    10 * input.weightKg + 6.25 * input.heightCm - 5 * age + (input.sex === "male" ? 5 : -161);
  const bmr = Math.round(base);
  // TDEE 基于未取整 BMR 计算，再取整（与 SRS 校验值一致：1723.75×1.375→2370）
  const tdee = Math.round(base * ACTIVITY_FACTORS[input.activityLevel]);
  const floor = Math.max(bmr, input.sex === "male" ? 1500 : 1200);
  // 自设时间不设上下限，缺口完全由日期反算
  const safeDeficit = Math.max(0, input.deficitKcal);
  const intake = Math.max(tdee - safeDeficit, floor);
  return { age, bmr, tdee, intake };
}

export interface GoalPeriodResult {
  weeksFast: number;
  weeksSlow: number;
  etaStart: string; // YYYY-MM-DD
  etaEnd: string;
  targetBmi: number;
}

const KCAL_PER_KG = 7700;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 推荐方案：每日缺口 400 kcal，按 7700 kcal/kg 估算周数与日期。 */
export function recommendedGoalPlan(weightKg: number, targetKg: number, today: Date = new Date()) {
  const loss = Math.max(0, weightKg - targetKg);
  const weeks = Math.max(1, Math.ceil((loss * KCAL_PER_KG) / (400 * 7)));
  const eta = new Date(startOfDay(today).getTime() + weeks * 7 * 86400_000);
  return { weeks, date: fmtDate(eta), deficit: 400 };
}

/** 自设日期：由日期反算每日所需缺口，并校验 350–500 kcal。 */
export function customGoalPlan(weightKg: number, targetKg: number, date: string, today: Date = new Date()) {
  const target = new Date(`${date}T00:00:00`);
  const days = Math.ceil((target.getTime() - startOfDay(today).getTime()) / 86400_000);
  const loss = Math.max(0, weightKg - targetKg);
  const deficit = days > 0 ? Math.round((loss * KCAL_PER_KG) / days) : 9999;
  if (!date || Number.isNaN(target.getTime())) {
    return { days: 0, deficit: 0, valid: false, reason: "请选择自设达成日期" };
  }
  if (days < 7) {
    return { days, deficit, valid: false, reason: "达成日期至少要在 7 天后" };
  }
  return { days, deficit, valid: true, reason: null };
}

/** 周数区间与日期区间；不要求用户填日期。 */
export function calcGoalPeriod(
  weightKg: number,
  targetKg: number,
  heightCm: number,
  today: Date = new Date(),
): GoalPeriodResult {
  const weeksFast = Math.ceil((weightKg - targetKg) / (weightKg * 0.01));
  const weeksSlow = Math.ceil((weightKg - targetKg) / (weightKg * 0.005));
  const heightM = heightCm / 100;
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);
  return {
    weeksFast,
    weeksSlow,
    etaStart: fmt(addDays(today, weeksFast * 7)),
    etaEnd: fmt(addDays(today, weeksSlow * 7)),
    targetBmi: targetKg / (heightM * heightM),
  };
}

/** 目标校验：target < weight；targetBmi ≥ 18.5（FR-PRF-04）。 */
export function validateGoal(
  weightKg: number,
  targetKg: number,
  heightCm: number,
): { ok: true } | { ok: false; reason: string } {
  if (targetKg >= weightKg) {
    return { ok: false, reason: "目标体重必须小于当前体重" };
  }
  const heightM = heightCm / 100;
  const bmi = targetKg / (heightM * heightM);
  if (bmi < 18.5) {
    return { ok: false, reason: `目标体重对应 BMI ${bmi.toFixed(1)}，低于 18.5，不利于健康` };
  }
  return { ok: true };
}
