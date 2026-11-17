/**
 * 周报聚合纯函数（SRS 6.13.4，必须严格按此实现）。
 * weekStart=上周一 weekEnd=上周日；只描述事实与差值，不判断好坏。
 */

export interface ReviewInput {
  /** 本周体重记录 [{date, weightKg}] */
  measurements: Array<{ date: string; weightKg: number }>;
  /** 前一周体重记录，用于 weightPrev */
  prevMeasurements: Array<{ date: string; weightKg: number }>;
  /** 本周腰围记录 [{date, waistCm}]，取最近一次 */
  waists: Array<{ date: string; waistCm: number }>;
  /** 最近一次腰围之前 4 周内的记录，取最近一次；无则本周一第一次作为基线 */
  waistFourWeeksAgo: Array<{ date: string; waistCm: number }>;
  /** 本周运动打卡 did_exercise=1 的天数 */
  exerciseDays: number;
  /** 本周 plan_items 数 */
  planSessions: number;
  /** 用药依从：已打卡时段 / 应服时段 */
  takenSlots: number;
  dueSlots: number;
  /** 本周指标 [{name, unit, date, value}] */
  indicators: Array<{ name: string; unit: string; date: string; value: number }>;
  /** 本周有任意记录的天数（0–7） */
  loggedDays: number;
}

export interface IndicatorChange {
  name: string;
  unit: string;
  from: number;
  to: number;
  delta: number;
  fromDate: string;
  toDate: string;
}

export interface WeekReport {
  weekStart: string;
  weekEnd: string;
  weightAvg: number | null;
  weightPrev: number | null;
  weightChange: number | null;
  waistLatest: number | null;
  waistChange: number | null;
  exerciseDays: number;
  planSessions: number;
  adherenceTaken: number;
  adherenceDue: number;
  adherenceRate: number; // 0–100
  indicatorChanges: IndicatorChange[];
  loggingRate: number; // 0–100
  weightRecordDays: number;
  insufficientData: boolean;
}

const avg = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 同一指标最近两次（本周内）的差值与日期（FR-REV / 6.13.4 indicatorChanges） */
export function computeIndicatorChanges(
  indicators: WeekReportInputIndicators,
): IndicatorChange[] {
  const byName = new Map<string, Array<{ name: string; unit: string; date: string; value: number }>>();
  for (const i of indicators) {
    const key = i.name;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(i);
  }
  const out: IndicatorChange[] = [];
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const from = sorted[sorted.length - 2]!;
    const to = sorted[sorted.length - 1]!;
    out.push({
      name: to.name, unit: to.unit,
      from: from.value, to: to.value, delta: round1(to.value - from.value),
      fromDate: from.date, toDate: to.date,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
type WeekReportInputIndicators = ReviewInput["indicators"];

/** 聚合周报（严格按 SRS 6.13.4） */
export function aggregateWeek(input: ReviewInput, weekStart: string, weekEnd: string): WeekReport {
  const weightAvgRaw = avg(input.measurements.map((m) => m.weightKg));
  const weightPrevRaw = avg(input.prevMeasurements.map((m) => m.weightKg));
  const weightChange = weightAvgRaw != null && weightPrevRaw != null
    ? round1(weightAvgRaw - weightPrevRaw)
    : null;

  const waistsSorted = [...input.waists].sort((a, b) => a.date.localeCompare(b.date));
  const waistLatest = waistsSorted.length ? waistsSorted[waistsSorted.length - 1]!.waistCm : null;
  const fourAgoSorted = [...input.waistFourWeeksAgo].sort((a, b) => a.date.localeCompare(b.date));
  const waistBase = fourAgoSorted.length ? fourAgoSorted[fourAgoSorted.length - 1]!.waistCm : null;
  const waistChange = waistLatest != null && waistBase != null ? round1(waistLatest - waistBase) : null;

  const adherenceRate = input.dueSlots === 0
    ? 0
    : Math.round((Math.min(input.takenSlots, input.dueSlots) / input.dueSlots) * 100);
  const weightRecordDays = new Set(input.measurements.map((m) => m.date)).size;
  // SRS：体重记录 <3 天 或 用药应服 0 → 样本不足
  const insufficientData = weightRecordDays < 3 || input.dueSlots === 0;

  return {
    weekStart, weekEnd,
    weightAvg: weightAvgRaw != null ? round1(weightAvgRaw) : null,
    weightPrev: weightPrevRaw != null ? round1(weightPrevRaw) : null,
    weightChange,
    waistLatest: waistLatest != null ? round1(waistLatest) : null,
    waistChange,
    exerciseDays: input.exerciseDays,
    planSessions: input.planSessions,
    adherenceTaken: Math.min(input.takenSlots, input.dueSlots),
    adherenceDue: input.dueSlots,
    adherenceRate,
    indicatorChanges: computeIndicatorChanges(input.indicators),
    loggingRate: Math.round((Math.max(0, Math.min(7, input.loggedDays)) / 7) * 100),
    weightRecordDays,
    insufficientData,
  };
}

/** 本地文字总结：只陈述事实与差值，语气中性，不判断好坏（SRS 6.13.4）。 */
export function summarizeWeek(r: WeekReport): string {
  if (r.insufficientData) {
    return "本周记录不足，以下结论仅供参考。等待更多记录后再看趋势。";
  }
  const parts: string[] = [];
  parts.push(r.weightChange == null
    ? "本周体重均值已记录，暂无上周对比。"
    : `本周体重均值 ${r.weightAvg} kg，较上周${r.weightChange > 0 ? "增加" : r.weightChange < 0 ? "减少" : "持平"} ${Math.abs(r.weightChange)} kg。`);
  parts.push(r.waistChange == null
    ? "腰围暂无可比数据。"
    : `最近腰围 ${r.waistLatest} cm，与 4 周前相比变化 ${r.waistChange > 0 ? "+" : ""}${r.waistChange} cm。`);
  parts.push(`运动 ${r.exerciseDays} 天，本周计划 ${r.planSessions} 项；用药已打卡 ${r.adherenceTaken}/${r.adherenceDue} 时段（${r.adherenceRate}%）。`);
  parts.push(`本周有记录 ${Math.round((r.loggingRate / 100) * 7)} 天，记录完成率 ${r.loggingRate}%。`);
  if (r.indicatorChanges.length) {
    parts.push("指标变化：" + r.indicatorChanges
      .map((c) => `${c.name} ${c.fromDate} ${c.from} → ${c.toDate} ${c.to}（${c.delta > 0 ? "+" : ""}${c.delta} ${c.unit}）`)
      .join("；") + "。");
  }
  return parts.join("");
}
