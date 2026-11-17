/**
 * AI 领域纯函数（SRS 6.11 / 附录 A / 9.1）：供应商配置、六类任务提示词、错误码映射。
 * 约束（SRS 3.5）：这里是纯数据/纯函数，不含 invoke、不含网络；Key 永不进入本模块。
 * 所有提示词改动必须同步提升 PROMPT_VERSION。
 */

/** 附录 A：提示词版本，写进每次 ai_runs 元数据，便于追溯 */
export const PROMPT_VERSION = "V1.0";

export type ProviderId = "deepseek" | "doubao" | "qwen";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** 豆包用推理接入点 ID，提示文案不同 */
  modelHint: string;
  keySource: string;
  /** 附录 D 默认价格（元/千 tokens），仅估算，用户可在设置修改 */
  priceIn: number;
  priceOut: number;
}

/** SRS 表 9-1 三家供应商默认配置 */
export const PROVIDERS: ProviderConfig[] = [
  {
    id: "deepseek", label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    modelHint: "模型名，如 deepseek-chat",
    keySource: "platform.deepseek.com",
    priceIn: 0.002, priceOut: 0.008,
  },
  {
    id: "doubao", label: "豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "",
    modelHint: "推理接入点 ID（ep-…）",
    keySource: "火山方舟控制台",
    priceIn: 0.0008, priceOut: 0.002,
  },
  {
    id: "qwen", label: "千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    modelHint: "模型名，如 qwen-plus",
    keySource: "阿里云百炼",
    priceIn: 0.0008, priceOut: 0.002,
  },
];

export function getProvider(id: ProviderId): ProviderConfig {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`未知 AI 供应商：${id}`);
  return found;
}

/** 附录 A.1 系统提示词，原文落地，不做改动 */
export const SYSTEM_PROMPT = `你是「减重提醒」中的生活方式管理助手，不是医生。必须遵守：
1. 只使用用户提供的 JSON 数据，不编造数据、日期或检验结果。
2. 不提供诊断、处方、停药/换药/剂量调整建议，不推荐具体药品或保健品。
3. 不建议低于 1200 kcal 的饮食或极端断食；不做身材羞辱，不制造焦虑。
4. 遇到胸痛、晕厥、极度乏力、非刻意快速消瘦、暴食催吐、孕产期、未成年等情况，停止建议并建议就医。
5. 只输出 JSON，不输出 Markdown、代码块或额外解释；字段严格按 schema。
6. 所有数字必须来自输入或可由输入直接推导；无法溯源就不写数字。
7. 用中文，短句；亮点最多 3 条，关注最多 3 条，建议最多 3 条。`;

export type TaskId =
  | "review"        // 周复盘（附录 A.2）
  | "diet"          // 饮食建议（附录 A.3）
  | "pdf"           // PDF 解析（附录 A.4）
  | "planReason"    // 计划理由
  | "chat"          // 自由问答
  | "plateau";      // 平台期归因

/** 附录 C 错误码（Rust 侧 AppError 的 code 一一对应） */
export type AiErrorCode =
  | "NO_KEY" | "AUTH" | "RATE_LIMIT" | "TIMEOUT" | "SERVER"
  | "INVALID_JSON" | "NETWORK" | "BUDGET" | "PDF_NO_TEXT" | "DB" | "OTHER";

/** 错误码 → 用户可见中文（SRS 9.5 / 表 9-4 / 附录 C），不展示堆栈 */
export const ERROR_MESSAGES: Record<AiErrorCode, string> = {
  NO_KEY: "还没配置密钥，请到设置里填写。",
  AUTH: "密钥无效，请重新填写。",
  RATE_LIMIT: "服务繁忙，稍后再试。",
  TIMEOUT: "连接超时，请重试。",
  SERVER: "服务暂时不可用，已使用本地版本。",
  INVALID_JSON: "结果格式异常，已使用本地版本。",
  NETWORK: "网络不可用，已使用本地数据。",
  BUDGET: "本月预算已用完，自动任务已停止。",
  PDF_NO_TEXT: "这份 PDF 没有可提取的文字，暂不支持图片。",
  DB: "数据未保存，请重试。输入已保留。",
  OTHER: "这次没拿到结果，请稍后重试。",
};

/** 安全解析 Rust 返回的 JSON 错误串（AppError 以 {"code":"XXX","message":"..."} 序列化） */
export function parseAiError(raw: unknown): { code: AiErrorCode; message: string } {
  const s = typeof raw === "string" ? raw : String(raw ?? "");
  try {
    const obj = JSON.parse(s) as { code?: string; message?: string };
    const code = (obj.code ?? "OTHER") as AiErrorCode;
    return { code: code in ERROR_MESSAGES ? code : "OTHER", message: obj.message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.OTHER };
  } catch {
    // 后端未返回结构化错误时，按内容兜底分类，绝不暴露堆栈
    if (/401|403|key.*invalid|invalid.*key/i.test(s)) return { code: "AUTH", message: ERROR_MESSAGES.AUTH };
    if (/429|rate.?limit/i.test(s)) return { code: "RATE_LIMIT", message: ERROR_MESSAGES.RATE_LIMIT };
    if (/timeout|超时/i.test(s)) return { code: "TIMEOUT", message: ERROR_MESSAGES.TIMEOUT };
    if (/network|网络|fetch/i.test(s)) return { code: "NETWORK", message: ERROR_MESSAGES.NETWORK };
    if (/budget|预算/i.test(s)) return { code: "BUDGET", message: ERROR_MESSAGES.BUDGET };
    return { code: "OTHER", message: ERROR_MESSAGES.OTHER };
  }
}

/** A.2 周复盘任务提示词（数据由调用方组装成 JSON 字符串注入） */
export function reviewPrompt(data: {
  userName: string; weekStart: string; weekEnd: string; snapshot: string; userNote?: string;
}): string {
  return `任务：生成 ${data.userName} 在 ${data.weekStart} 至 ${data.weekEnd} 的周复盘。
数据： ${data.snapshot}
用户备注：${data.userNote ?? ""}
要求：先判断记录是否充分；不足则只说明不足。按 schema 输出。`;
}

/** A.3 饮食建议任务提示词 */
export function dietPrompt(data: {
  userName: string; intakeKcal: number; proteinG: number; fatG: number; carbG: number;
  diseases: string[]; avoid: string; taste: string; eatingOut: string;
}): string {
  return `任务：为 ${data.userName} 生成一周饮食建议。
输入：目标摄入 ${data.intakeKcal} kcal；蛋白质 ${data.proteinG} g；脂肪 ${data.fatG} g；碳水 ${data.carbG} g；
疾病：${data.diseases.join("、") || "无"}；忌口/过敏：${data.avoid || "无"}；口味：${data.taste || "不限"}；外食频率：${data.eatingOut || "未填"}。
要求：给出 3 餐 + 1 加餐模板、四类替换、外食策略；总热量与目标偏差 ≤10%；
按疾病叠加约束（高血压限钠、糖尿病定量碳水、痛风限嘌呤、肾病遵医嘱）；
标注“估算值”，不承诺疗效。按 schema 输出。`;
}

/** A.4 PDF 解析任务提示词（文本已由前端脱敏、截断） */
export function pdfPrompt(pdfText: string): string {
  return `任务：从以下体检报告文本中提取指标、疾病、用药候选。
只提取文本中明确出现的内容；不确定的置信度 <0.8；不要推断缺失值。
报告文本： ${pdfText}
按 schema 输出：indicators[{name,value,unit,measured_on,confidence}]、diseases[{name,confidence}]、medications[{name,dose,dose_unit,confidence}]。`;
}

/** 计划理由（FR-AI-04）：只解释已有计划，不新增热量数字、不做医疗建议 */
export function planReasonPrompt(snapshot: string): string {
  return `任务：用一句话解释下面这份运动计划为什么这样安排（结合天气与禁忌），不新增数据、不给出热量数字、不做医疗建议。
计划快照： ${snapshot}
按 schema 输出。`;
}

/** 平台期归因（FR-AI-04）：只基于记录事实，说明可能因素，不下诊断 */
export function plateauPrompt(snapshot: string): string {
  return `任务：根据下面的记录事实，说明体重变化放缓可能相关的生活方式因素；只陈述可从数据推导的内容，不做诊断、不推荐药品或极端饮食。
记录快照： ${snapshot}
按 schema 输出。`;
}

/** 自由问答（FR-AI-04）：把用户问题原样交给模型，系统提示词保证边界 */
export function chatPrompt(question: string, snapshot: string): string {
  return `用户问题：${question}
当前成员的可分享数据快照（若为空则不要臆测）：${snapshot}
用中文短句回答；涉及诊断/用药/保健品一律拒绝并建议就医；只输出 JSON。`;
}

/** 组装 messages：系统提示词固定在前，任务提示词在后（jsonMode 由调用方透传） */
export function buildMessages(_task: TaskId, userPrompt: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];
}

/** 判断某任务是否需要结构化 JSON 输出（附录 A：分析类任务均为 JSON） */
export function isStructuredTask(task: TaskId): boolean {
  return task !== "chat";
}
