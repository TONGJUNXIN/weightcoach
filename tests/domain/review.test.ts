import { describe, expect, it } from "vitest";
import { aggregateWeek, computeIndicatorChanges, summarizeWeek, type ReviewInput } from "@/domain/review";

const base: ReviewInput = {
  measurements: [
    { date: "2026-11-10", weightKg: 82 },
    { date: "2026-11-12", weightKg: 81 },
    { date: "2026-11-15", weightKg: 80 },
  ],
  prevMeasurements: [
    { date: "2026-11-03", weightKg: 83 },
    { date: "2026-11-05", weightKg: 82 },
  ],
  waists: [{ date: "2026-11-15", waistCm: 86 }],
  waistFourWeeksAgo: [{ date: "2026-10-18", waistCm: 90 }],
  exerciseDays: 3,
  planSessions: 4,
  takenSlots: 18,
  dueSlots: 21,
  indicators: [
    { name: "TC", unit: "mmol/L", date: "2026-11-09", value: 5.8 },
    { name: "TC", unit: "mmol/L", date: "2026-11-15", value: 5.4 },
  ],
  loggedDays: 6,
};

describe("aggregateWeek 周报聚合（SRS 6.13.4）", () => {
  const r = aggregateWeek(base, "2026-11-10", "2026-11-16");
  it("体重均值与上周对比", () => {
    expect(r.weightAvg).toBe(81);
    expect(r.weightPrev).toBe(82.5);
    expect(r.weightChange).toBe(-1.5);
  });
  it("腰围 = 最近 - 4 周前最近", () => {
    expect(r.waistLatest).toBe(86);
    expect(r.waistChange).toBe(-4);
  });
  it("运动天数/计划次数/依从率/记录完成率", () => {
    expect(r.exerciseDays).toBe(3);
    expect(r.planSessions).toBe(4);
    expect(r.adherenceTaken).toBe(18);
    expect(r.adherenceDue).toBe(21);
    expect(r.adherenceRate).toBe(86);
    expect(r.loggingRate).toBe(86);
  });
  it("样本充足：体重≥3天且应服>0", () => {
    expect(r.weightRecordDays).toBe(3);
    expect(r.insufficientData).toBe(false);
  });
  it("样本不足：体重 <3 天", () => {
    const r2 = aggregateWeek({ ...base, measurements: base.measurements.slice(0, 2) }, "2026-11-10", "2026-11-16");
    expect(r2.insufficientData).toBe(true);
  });
  it("样本不足：用药应服 0", () => {
    const r3 = aggregateWeek({ ...base, dueSlots: 0, takenSlots: 0 }, "2026-11-10", "2026-11-16");
    expect(r3.insufficientData).toBe(true);
    expect(r3.adherenceRate).toBe(0);
  });
  it("无数据时均值/变化为 null，不编造", () => {
    const r4 = aggregateWeek({
      ...base, measurements: [], prevMeasurements: [], waists: [], waistFourWeeksAgo: [], indicators: [],
    }, "2026-11-10", "2026-11-16");
    expect(r4.weightAvg).toBeNull();
    expect(r4.weightChange).toBeNull();
    expect(r4.waistChange).toBeNull();
    expect(r4.indicatorChanges).toEqual([]);
  });
});

describe("computeIndicatorChanges 指标变化", () => {
  it("同一指标按日期取最近两次差值", () => {
    const c = computeIndicatorChanges(base.indicators);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ name: "TC", from: 5.8, to: 5.4, delta: -0.4 });
  });
  it("仅 1 次测量的指标不产生变化", () => {
    expect(computeIndicatorChanges([
      { name: "TG", unit: "mmol/L", date: "2026-11-15", value: 1.8 },
    ])).toEqual([]);
  });
});

describe("summarizeWeek 中性总结", () => {
  it("样本不足时明确提示，不编造趋势", () => {
    const r = aggregateWeek({ ...base, measurements: base.measurements.slice(0, 1) }, "2026-11-10", "2026-11-16");
    expect(summarizeWeek(r)).toContain("本周记录不足");
  });
  it("只描述事实与差值，不出现好坏判断词", () => {
    const text = summarizeWeek(aggregateWeek(base, "2026-11-10", "2026-11-16"));
    expect(text).toContain("本周体重均值 81 kg，较上周减少 1.5 kg");
    expect(text).toContain("18/21");
    expect(text).not.toMatch(/优秀|良好|变差|失败|成功|健康/);
  });
});
