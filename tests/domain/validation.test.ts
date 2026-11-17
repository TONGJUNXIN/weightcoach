import { describe, expect, it } from "vitest";
import {
  validateBirthYear, validateDiseaseName, validateHeight, validateIndicator,
  validateMemberName, validateWaist, validateWeight,
} from "@/domain/validation";
import { DISEASE_PRESETS, findPreset } from "@/domain/diseaseTemplates";
import { validateGoal } from "@/domain/energy";

describe("成员与档案校验", () => {
  it("姓名 1–12 字", () => {
    expect(validateMemberName("").ok).toBe(false);
    expect(validateMemberName("张三").ok).toBe(true);
    expect(validateMemberName("一二三四五六七八九十一二三四").ok).toBe(false);
  });
  it("出生年 / 身高 / 体重范围", () => {
    expect(validateBirthYear(1899).ok).toBe(false);
    expect(validateBirthYear(1990).ok).toBe(true);
    expect(validateHeight(250).ok).toBe(true);
    expect(validateHeight(260).ok).toBe(false);
    expect(validateWeight(20).ok).toBe(true);
    expect(validateWeight(19).ok).toBe(false);
  });
  it("AC-04：目标 BMI < 18.5 被拒绝", () => {
    expect(validateGoal(80, 40, 175).ok).toBe(false);
    expect(validateGoal(80, 70, 175).ok).toBe(true);
  });
});

describe("疾病与指标", () => {
  it("AC-06：高血脂带 TC/TG/LDL/HDL 四项", () => {
    const preset = findPreset("hyperlipidemia");
    expect(preset?.indicators.map((i) => i.name)).toEqual(["TC", "TG", "LDL", "HDL"]);
    expect(DISEASE_PRESETS).toHaveLength(8);
  });
  it("疾病名 ≤20 字", () => {
    expect(validateDiseaseName("").ok).toBe(false);
    expect(validateDiseaseName("一二三四五六七八九十一二三四五六七八九十一").ok).toBe(false);
  });
  it("指标校验：有限数、单位 ≤8、日期不晚于今天", () => {
    const today = new Date(2026, 10, 16);
    expect(validateIndicator({ value: Number.NaN, unit: "mmol/L", measuredOn: "2026-11-16" }, today).ok).toBe(false);
    expect(validateIndicator({ value: 5.2, unit: "十个字符的单位长度超了", measuredOn: "2026-11-16" }, today).ok).toBe(false);
    expect(validateIndicator({ value: 5.2, unit: "mmol/L", measuredOn: "2026-11-17" }, today).ok).toBe(false);
    expect(validateIndicator({ value: 5.2, unit: "mmol/L", measuredOn: "2026-11-16" }, today).ok).toBe(true);
  });
});

describe("AC-12：腰围范围", () => {
  it("25 / 250 均拒绝，30 / 200 通过", () => {
    expect(validateWaist(25).ok).toBe(false);
    expect(validateWaist(250).ok).toBe(false);
    expect(validateWaist(30).ok).toBe(true);
    expect(validateWaist(200).ok).toBe(true);
  });
});
