/**
 * AI 月度预算纯函数（SRS FR-AI-07 / 附录 D）：
 * 默认 5 元/月；80% 提示；100% 停自动任务、手动需二次确认；按 token 估算成本。
 * 估算不替代供应商账单，价格可在设置中按官网修改。
 */

export const DEFAULT_MONTHLY_BUDGET = 5;
export const WARN_RATIO = 0.8;

export interface CostEstimate {
  cost: number;
}

/** 按输入/输出千 tokens 价格估算单次成本（元），保留 6 位小数避免累计误差 */
export function estimateCost(
  tokensIn: number,
  tokensOut: number,
  priceInPerK: number,
  priceOutPerK: number,
): number {
  const raw = (Math.max(0, tokensIn) / 1000) * priceInPerK + (Math.max(0, tokensOut) / 1000) * priceOutPerK;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

/** 价格缺省解析：空值/非法值回退到供应商默认单价，避免 Number(null)=0 让预算失效 */
export function resolvePrice(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type BudgetVerdict =
  | { kind: "ok"; ratio: number }
  | { kind: "warn"; ratio: number }
  | { kind: "blocked"; ratio: number };

/**
 * 预算判定：用于"本次调用前"拦截。
 * - 自动任务：ok → 放行；warn → 放行但提示；blocked → 停止。
 * - 手动任务：blocked 时调用方仍需二次确认后才放行（本函数只报告状态）。
 */
export function checkBudget(spent: number, budget: number): BudgetVerdict {
  const cap = budget > 0 ? budget : DEFAULT_MONTHLY_BUDGET;
  const ratio = spent / cap;
  if (ratio >= 1) return { kind: "blocked", ratio };
  if (ratio >= WARN_RATIO) return { kind: "warn", ratio };
  return { kind: "ok", ratio };
}

/** 本地月份键 YYYY-MM，用于"本月成本"去重（本地时间，与全项目口径一致） */
export function monthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 累计成本（元），保留 6 位 */
export function addCost(current: number, delta: number): number {
  return Math.round((current + delta) * 1_000_000) / 1_000_000;
}
