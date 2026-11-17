import { describe, expect, it } from "vitest";
import {
  adherenceRate,
  dailyAdherence,
  isBackfillDateValid,
  isEveningSlot,
  isQuietHours,
  mondayBasedWeekday,
  mondayOf,
  shouldPromptReviewOnBoot,
  shouldPromptWeightOnBoot,
} from "@/domain/adherence";

describe("adherenceRate 依从率", () => {
  it("3 次/天 × 7 天 = 21，全打卡 21/21=100%", () => {
    expect(adherenceRate(21, 21)).toEqual({ taken: 21, scheduled: 21, rate: 100 });
  });
  it("漏 1 次 20/21=95%", () => {
    expect(adherenceRate(20, 21).rate).toBe(95);
  });
  it("应服 0 时段 → 0，不编造", () => {
    expect(adherenceRate(0, 0)).toEqual({ taken: 0, scheduled: 0, rate: 0 });
  });
  it("分子被夹在 [0, scheduled]，容忍异常入参", () => {
    expect(adherenceRate(30, 10)).toEqual({ taken: 10, scheduled: 10, rate: 100 });
    expect(adherenceRate(-3, 10).taken).toBe(0);
  });
});

describe("dailyAdherence 单日依从", () => {
  it("只有 taken 计入分子；skipped/missed/null 不算", () => {
    const r = dailyAdherence([
      { id: "a", status: "taken" },
      { id: "b", status: "skipped" },
      { id: "c", status: "missed" },
      { id: "d", status: null },
    ]);
    expect(r).toEqual({ taken: 1, scheduled: 4, rate: 25 });
  });
});

describe("isEveningSlot 晚间时段", () => {
  it("18:00–23:59 命中", () => {
    expect(isEveningSlot("18:00")).toBe(true);
    expect(isEveningSlot("21:00")).toBe(true);
    expect(isEveningSlot("23:59")).toBe(true);
  });
  it("晨间药不进入晚间提醒", () => {
    expect(isEveningSlot("08:00")).toBe(false);
    expect(isEveningSlot("17:59")).toBe(false);
  });
  it("非法时间返回 false", () => {
    expect(isEveningSlot("24:00")).toBe(false);
    expect(isEveningSlot("21:60")).toBe(false);
    expect(isEveningSlot("x")).toBe(false);
  });
});

describe("isQuietHours 免打扰", () => {
  it("23:00–06:00 免打扰", () => {
    expect(isQuietHours(23)).toBe(true);
    expect(isQuietHours(2)).toBe(true);
    expect(isQuietHours(5)).toBe(true);
    expect(isQuietHours(6)).toBe(false);
    expect(isQuietHours(22)).toBe(false);
  });
});

describe("mondayBasedWeekday / mondayOf 周一起点", () => {
  it("周一=0 … 周日=6", () => {
    expect(mondayBasedWeekday(new Date(2026, 10, 16))).toBe(0); // 2026-11-16 周一
    expect(mondayBasedWeekday(new Date(2026, 10, 22))).toBe(6); // 周日
  });
  it("mondayOf 回退到本周一", () => {
    expect(mondayOf(new Date(2026, 10, 16, 9, 0))).toBe("2026-11-16");
    expect(mondayOf(new Date(2026, 10, 22, 9, 0))).toBe("2026-11-16");
  });
});

describe("shouldPromptWeightOnBoot 开机体重提醒", () => {
  const base = { hasWeightToday: false, lastPromptDate: null, today: "2026-11-16" };
  it("06:00–10:59 未记录未弹过 → 弹（05:00–05:59 落在免打扰不弹）", () => {
    expect(shouldPromptWeightOnBoot({ ...base, hour: 6 })).toBe(true);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 7 })).toBe(true);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 10 })).toBe(true);
  });
  it("已记录 / 已弹过 / 时段外 / 夜间 / 免打扰 → 不弹", () => {
    expect(shouldPromptWeightOnBoot({ ...base, hour: 7, hasWeightToday: true })).toBe(false);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 7, lastPromptDate: "2026-11-16" })).toBe(false);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 11 })).toBe(false);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 23 })).toBe(false);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 4 })).toBe(false);
    expect(shouldPromptWeightOnBoot({ ...base, hour: 5 })).toBe(false); // 免打扰优先
  });
});

describe("shouldPromptReviewOnBoot 周一复盘提醒", () => {
  const base = {
    weekday: 0,
    hour: 8,
    hasLastWeekData: true,
    lastPromptWeek: null,
    thisMonday: "2026-11-16",
  };
  it("周一上午、上周有数据、未弹过 → 弹", () => {
    expect(shouldPromptReviewOnBoot(base)).toBe(true);
  });
  it("非周一 / 时段外 / 无数据 / 已弹过 → 不弹", () => {
    expect(shouldPromptReviewOnBoot({ ...base, weekday: 1 })).toBe(false);
    expect(shouldPromptReviewOnBoot({ ...base, hour: 12 })).toBe(false);
    expect(shouldPromptReviewOnBoot({ ...base, hasLastWeekData: false })).toBe(false);
    expect(shouldPromptReviewOnBoot({ ...base, lastPromptWeek: "2026-11-16" })).toBe(false);
  });
});

describe("isBackfillDateValid 补记范围", () => {
  const today = "2026-11-16";
  it("今天与过去 30 天内可补记", () => {
    expect(isBackfillDateValid("2026-11-16", today)).toBe(true);
    expect(isBackfillDateValid("2026-10-17", today)).toBe(true); // 30 天前
  });
  it("未来日期 / 超 30 天 / 非法格式拒绝", () => {
    expect(isBackfillDateValid("2026-11-17", today)).toBe(false);
    expect(isBackfillDateValid("2026-10-16", today)).toBe(false); // 31 天前
    expect(isBackfillDateValid("2026-13-01", today)).toBe(false);
    expect(isBackfillDateValid("bad", today)).toBe(false);
  });
});
