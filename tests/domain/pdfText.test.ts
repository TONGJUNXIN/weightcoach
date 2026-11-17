import { describe, expect, it } from "vitest";
import {
  isTextlessPdf, preparePdfText, sanitizePdfText,
} from "@/lib/pdfText";

describe("sanitizePdfText（SRS 9.4 脱敏）", () => {
  it("隐去 18 位身份证号（含 X 结尾）", () => {
    expect(sanitizePdfText("身份证 110101199001011234 已核对")).toContain("[身份证已隐去]");
    expect(sanitizePdfText("证号 11010119900101123X")).not.toContain("11010119900101123X");
  });

  it("隐去手机号", () => {
    expect(sanitizePdfText("电话 13812345678 请联系")).toContain("[手机号已隐去]");
    expect(sanitizePdfText("电话 13812345678 请联系")).not.toContain("13812345678");
  });

  it("隐去邮箱", () => {
    expect(sanitizePdfText("邮箱 zhang.san@example.com")).toContain("[邮箱已隐去]");
  });

  it("保留正常医疗文本", () => {
    const text = "总胆固醇 5.2 mmol/L，低密度脂蛋白 3.4 mmol/L，未见异常。";
    expect(sanitizePdfText(text)).toBe(text);
  });
});

describe("preparePdfText（页数/字符限制）", () => {
  it("正常文本拼接并脱敏", () => {
    const r = preparePdfText(["总胆固醇 5.2 mmol/L。", "LDL-C 3.4 mmol/L。"]);
    expect(r.text).toContain("总胆固醇");
    expect(r.pages).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it("超过 20 页截断并标记", () => {
    const pages = Array.from({ length: 25 }, (_, i) => `第${i + 1}页内容足够长的文本用于测试截断逻辑。`);
    const r = preparePdfText(pages);
    expect(r.pages).toBe(25);
    expect(r.truncated).toBe(true);
    expect(r.text).not.toContain("第21页");
  });

  it("超过 5 万字符截断并标记", () => {
    const r = preparePdfText(["字".repeat(60_000)]);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(50_000);
  });
});

describe("isTextlessPdf（FR-REC-09 扫描件判定）", () => {
  it("短文本判为扫描件", () => {
    expect(isTextlessPdf("扫描")).toBe(true);
    expect(isTextlessPdf("   ".repeat(5))).toBe(true);
  });

  it("足够长的文本型 PDF 不判扫描件", () => {
    expect(isTextlessPdf("检验报告".repeat(40))).toBe(false);
  });
});
