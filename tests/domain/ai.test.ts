import { describe, expect, it } from "vitest";
import {
  buildMessages, ERROR_MESSAGES, getProvider, isStructuredTask, parseAiError,
  pdfPrompt, PROVIDERS, PROMPT_VERSION, reviewPrompt, SYSTEM_PROMPT,
} from "@/domain/ai";

describe("供应商配置（SRS 表 9-1）", () => {
  it("三家均可保存且默认参数正确", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["deepseek", "doubao", "qwen"]);
    expect(getProvider("deepseek").baseUrl).toBe("https://api.deepseek.com");
    expect(getProvider("deepseek").defaultModel).toBe("deepseek-chat");
    expect(getProvider("doubao").baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(getProvider("qwen").defaultModel).toBe("qwen-plus");
  });

  it("豆包模型提示是推理接入点 ID", () => {
    expect(getProvider("doubao").modelHint).toContain("ep-");
  });

  it("未知供应商抛错", () => {
    expect(() => getProvider("unknown" as never)).toThrow();
  });
});

describe("提示词（附录 A）", () => {
  it("保留 prompt_version 与系统提示词边界", () => {
    expect(PROMPT_VERSION).toBe("V1.0");
    expect(SYSTEM_PROMPT).toContain("不是医生");
    expect(SYSTEM_PROMPT).toContain("只输出 JSON");
    expect(SYSTEM_PROMPT).toContain("不提供诊断");
  });

  it("messages 以系统提示词在前", () => {
    const m = buildMessages("review", reviewPrompt({
      userName: "小明", weekStart: "2026-11-09", weekEnd: "2026-11-15", snapshot: "{}",
    }));
    expect(m[0]?.role).toBe("system");
    expect(m[1]?.role).toBe("user");
    expect(m[1]?.content).toContain("小明");
  });

  it("PDF 提示词要求置信度<0.8 与不推断", () => {
    expect(pdfPrompt("检验文本")).toContain("置信度 <0.8");
    expect(pdfPrompt("检验文本")).toContain("不要推断缺失值");
  });

  it("分析类任务结构化、自由问答不强制", () => {
    expect(isStructuredTask("review")).toBe(true);
    expect(isStructuredTask("pdf")).toBe(true);
    expect(isStructuredTask("chat")).toBe(false);
  });
});

describe("错误码映射（附录 C / 9.5）", () => {
  it("解析 Rust 结构化错误", () => {
    expect(parseAiError('{"code":"AUTH","message":"bad key"}').code).toBe("AUTH");
    expect(parseAiError('{"code":"RATE_LIMIT"}').message).toBe(ERROR_MESSAGES.RATE_LIMIT);
  });

  it("非结构化错误按内容兜底，不暴露堆栈", () => {
    expect(parseAiError("HTTP 429 too many requests").code).toBe("RATE_LIMIT");
    expect(parseAiError("request timeout").code).toBe("TIMEOUT");
    expect(parseAiError("something weird").code).toBe("OTHER");
    expect(parseAiError("something weird").message).not.toContain("at ");
  });

  it("所有错误码均有中文文案", () => {
    for (const msg of Object.values(ERROR_MESSAGES)) expect(msg.length).toBeGreaterThan(0);
  });
});
