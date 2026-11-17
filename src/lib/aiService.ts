/**
 * AI 调用编排（SRS 6.11 / 9.5）：启用检查 → 预算拦截 → invoke ai_chat →
 * Zod 校验（失败修复 1 次）→ 成功/降级 → 写 ai_runs 元数据 + 累计成本。
 * 所有失败只返回状态与文案，不弹错误框（SRS 5.x 失败不弹对话框）。
 */
import { invoke } from "@tauri-apps/api/core";
import {
  buildMessages, getProvider, isStructuredTask, parseAiError, type AiErrorCode, type TaskId,
} from "@/domain/ai";
import { checkBudget, estimateCost, monthKey, type BudgetVerdict } from "@/domain/aiBudget";
import { stripJsonFence, validateOutput, type ChatOutput } from "@/domain/aiSchemas";
import {
  aiRunRepo, getAiConfig, settingsRepo, SETTINGS, type AiConfig,
} from "@/db/repositories";

export interface AiResponse<T> {
  source: "ai" | "local";
  data?: T;
  /** chat 任务的纯文本答案 */
  text?: string;
  error?: { code: AiErrorCode; message: string };
  /** 预算拦截：auto=停止；manual=需二次确认 */
  budget?: BudgetVerdict;
}

interface ChatResultRaw {
  content: string;
  usage: { prompt_tokens: number | null; completion_tokens: number | null };
}

/** 读取当前配置（按选中供应商取默认 URL/模型/价格） */
export async function loadAiConfig(): Promise<AiConfig> {
  const provider = (await settingsRepo.get(SETTINGS.aiProvider)) ?? "deepseek";
  const def = PROVIDER_SAFE(provider);
  return getAiConfig(def.baseUrl, def.defaultModel, def.priceIn, def.priceOut);
}

// 避免循环依赖：这里内联一个安全的供应商默认值查表（与 domain/ai PROVIDERS 同源）
function PROVIDER_SAFE(provider: string) {
  try {
    return getProvider(provider as never);
  } catch {
    return getProvider("deepseek");
  }
}

/** 预算状态：以 ai_runs 本月成功调用的 cost 求和为权威（created_at 前缀按本地月份，跨月自动归零） */
export async function currentBudget(cfg?: AiConfig): Promise<{ verdict: BudgetVerdict; spent: number; budget: number }> {
  const config = cfg ?? await loadAiConfig();
  const mk = monthKey(new Date());
  const spent = await aiRunRepo.monthSpent(mk);
  return { verdict: checkBudget(spent, config.budget), spent, budget: config.budget };
}

export interface CallOptions {
  task: TaskId;
  userId: string | null;
  userPrompt: string;
  /** 本地降级数据（AI 关闭或失败时返回，source=local） */
  fallback?: unknown;
  /** 手动触发：预算超限时需二次确认；自动任务直接停 */
  manual?: boolean;
  budgetConfirmed?: boolean;
}

/**
 * 发起一次 AI 调用。返回 source='ai' 表示模型结果，'local' 表示降级/未启用。
 * 只写元数据到 ai_runs（不含正文），Key 由 Rust 从凭据管理器读取，前端全程不可见。
 */
export async function callAi<T>(opts: CallOptions): Promise<AiResponse<T>> {
  const cfg = await loadAiConfig();
  const local = (error?: { code: AiErrorCode; message: string }, budget?: BudgetVerdict): AiResponse<T> => ({
    source: "local",
    data: opts.fallback as T | undefined,
    text: opts.task === "chat" && opts.fallback ? String(opts.fallback) : undefined,
    error,
    budget,
  });

  // FR-AI-10：一键关闭后所有 AI 入口走本地，不发任何网络请求
  if (!cfg.enabled) return local();

  const { verdict } = await currentBudget(cfg);
  if (verdict.kind === "blocked") {
    // FR-AI-07：100% 停自动；手动需用户二次确认
    if (!opts.manual || !opts.budgetConfirmed) {
      return local({ code: "BUDGET", message: "本月预算已用完，自动任务已停止。" }, verdict);
    }
  }

  const provider = cfg.provider;
  const model = cfg.model || PROVIDER_SAFE(provider).defaultModel;
  const jsonMode = isStructuredTask(opts.task);
  const messages = buildMessages(opts.task, opts.userPrompt);

  const doInvoke = async (msgs: Array<{ role: "system" | "user"; content: string }>) =>
    invoke<ChatResultRaw>("ai_chat", {
      args: {
        provider,
        base_url: cfg.baseUrl,
        model,
        messages: msgs,
        json_mode: jsonMode,
      },
    });

  let raw: ChatResultRaw;
  try {
    raw = await doInvoke(messages);
  } catch (e) {
    const err = parseAiError(e);
    await aiRunRepo.record({ userId: opts.userId, task: opts.task, provider, model, status: "error", errorCode: err.code }).catch(() => {});
    return local(err);
  }

  // FR-AI-05：校验失败 → 修复 1 次 → 仍失败降级本地模板
  if (jsonMode) {
    let validated = validateOutput<T>(opts.task, raw.content);
    if (!validated.ok) {
      const repairMsgs = [
        ...messages,
        { role: "user" as const, content: `上次输出不符合 schema（${validated.error}）。请严格按 schema 只输出修正后的 JSON，不要代码块。` },
      ];
      try {
        const retryRaw = await doInvoke(repairMsgs);
        validated = validateOutput<T>(opts.task, retryRaw.content);
        raw = retryRaw; // 以修复轮为准记账
      } catch (e2) {
        const err = parseAiError(e2);
        await aiRunRepo.record({ userId: opts.userId, task: opts.task, provider, model, status: "error", errorCode: err.code }).catch(() => {});
        return local(err);
      }
    }
    if (!validated.ok) {
      await aiRunRepo.record({ userId: opts.userId, task: opts.task, provider, model, status: "local", errorCode: "INVALID_JSON" }).catch(() => {});
      return local({ code: "INVALID_JSON", message: "结果格式异常，已使用本地版本。" });
    }
    await recordSuccess(opts, cfg, provider, model, raw);
    if (opts.task === "chat") {
      return { source: "ai", data: validated.data, text: (validated.data as ChatOutput)?.answer };
    }
    return { source: "ai", data: validated.data };
  }

  // 非结构化任务：直接返回文本
  await recordSuccess(opts, cfg, provider, model, raw);
  return { source: "ai", text: stripJsonFence(raw.content) };
}

/** 记账：写 ai_runs 元数据 + 累加本月成本（估算，跨月归零） */
async function recordSuccess(opts: CallOptions, cfg: AiConfig, provider: string, model: string, raw: ChatResultRaw): Promise<void> {
  const tokensIn = raw.usage?.prompt_tokens ?? null;
  const tokensOut = raw.usage?.completion_tokens ?? null;
  const cost = estimateCost(tokensIn ?? 0, tokensOut ?? 0, cfg.priceIn, cfg.priceOut);
  await aiRunRepo.record({
    userId: opts.userId, task: opts.task, provider, model,
    status: "ok", tokensIn, tokensOut, cost,
  }).catch(() => {});
}

/** 测试连接：发一条最小 chat 请求，返回模型名/延迟/HTTP 状态；不写 ai_runs。 */
export async function testConnection(provider: string, baseUrl: string, model: string): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  try {
    await invoke<ChatResultRaw>("ai_chat", {
      args: {
        provider, base_url: baseUrl, model,
        messages: [{ role: "user", content: "回复 JSON：{\"ok\":true}" }],
        json_mode: false,
      },
    });
    return { ok: true, latencyMs: Date.now() - start, message: `连接成功 · ${model}` };
  } catch (e) {
    const err = parseAiError(e);
    return { ok: false, latencyMs: Date.now() - start, message: err.message };
  }
}
