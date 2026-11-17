/**
 * S2 领域纯函数（SRS 6.5 用药打卡 / 6.7 提醒 / 第 10 章）。
 * 全部为无副作用纯函数，便于 Vitest 穷举边界。
 */

export type MedLogStatus = "taken" | "skipped" | "missed";

/** 依从率结果：taken/scheduled 为分子分母，rate 为四舍五入百分比（0–100）。 */
export interface Adherence {
  taken: number;
  scheduled: number;
  rate: number;
}

/** 应服 0 时段时依从率为 0（SRS FR-REV-05：用药应服 0 视为样本不足，不编造）。 */
export function adherenceRate(taken: number, scheduled: number): Adherence {
  const safeScheduled = Math.max(0, scheduled);
  const safeTaken = Math.min(Math.max(0, taken), safeScheduled);
  return {
    taken: safeTaken,
    scheduled: safeScheduled,
    rate: safeScheduled === 0 ? 0 : Math.round((safeTaken / safeScheduled) * 100),
  };
}

/**
 * 单日依从率：一个时段已打卡 taken 即计入分子。
 * skipped/missed/null 都算未服（SRS FR-MED-04：依从率 = 已打卡时段 ÷ 应服时段）。
 */
export function dailyAdherence(
  slots: Array<{ id: string; status: MedLogStatus | null }>,
): Adherence {
  return adherenceRate(slots.filter((s) => s.status === "taken").length, slots.length);
}

/** 晚间时段 18:00–23:59（SRS FR-MED-07：21:00 提醒只统计该区间未打卡时段）。 */
export function isEveningSlot(timeOfDay: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeOfDay.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return false;
  return h >= 18 && h <= 23;
}

/** 免打扰时段 23:00–06:00（SRS FR-RMD-07 / 10.3）。 */
export function isQuietHours(hour: number): boolean {
  return hour >= 23 || hour < 6;
}

/** 本地日期转「周一起点」星期：周一=0 … 周日=6（SRS 3.5）。 */
export function mondayBasedWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * 开机体重提醒判定（SRS FR-RMD-01/05/07）：
 * 05:00–10:59 且当天未记录体重 且今天未弹过 → 弹；夜间免打扰不弹。
 */
export function shouldPromptWeightOnBoot(args: {
  hour: number;
  hasWeightToday: boolean;
  lastPromptDate: string | null;
  today: string;
}): boolean {
  const { hour, hasWeightToday, lastPromptDate, today } = args;
  if (isQuietHours(hour)) return false;
  if (hour < 5 || hour > 10) return false;
  if (hasWeightToday) return false;
  if (lastPromptDate === today) return false;
  return true;
}

/**
 * 周一复盘提醒判定（SRS FR-RMD-04/05）：
 * 周一 08:00–11:59 且上周有任意记录 且本周未弹过 → 弹。
 */
export function shouldPromptReviewOnBoot(args: {
  weekday: number; // 0=周一
  hour: number;
  hasLastWeekData: boolean;
  lastPromptWeek: string | null; // 周一日期 YYYY-MM-DD
  thisMonday: string;
}): boolean {
  const { weekday, hour, hasLastWeekData, lastPromptWeek, thisMonday } = args;
  if (weekday !== 0) return false;
  if (hour < 8 || hour > 11) return false;
  if (!hasLastWeekData) return false;
  if (lastPromptWeek === thisMonday) return false;
  return true;
}

/**
 * 补记日期校验（SRS FR-REC-05）：过去 30 天内（含今天），禁止未来日期。
 */
export function isBackfillDateValid(date: string, today: string, maxDays = 30): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00`);
  const t = new Date(`${today}T00:00:00`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(t.getTime())) return false;
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000);
  return diff >= 0 && diff <= maxDays;
}

/** 本周一日期（本地）；用于复盘去重键。 */
export function mondayOf(date: Date): string {
  const offset = mondayBasedWeekday(date);
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
