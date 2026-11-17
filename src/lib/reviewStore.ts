/** 历史周报存储（FR-REV-07）：按成员 + 周保存到 app_settings 的 JSON，本地版与 AI 版分别标注。 */
import { settingsRepo } from "@/db/repositories";
import type { WeekReport } from "@/domain/review";

export interface StoredReview {
  report: WeekReport;
  summary: string;
  generatedAt: string;
  source: "local" | "ai";
}

const KEY_PREFIX = "week_review_";

/** 必须带 userId：周报是成员私有数据，不能按周全局共享（P0-3）。 */
export function reviewKey(userId: string, weekMonday: string): string {
  return `${KEY_PREFIX}${userId}_${weekMonday}`;
}

export async function saveReview(userId: string, weekMonday: string, entry: StoredReview): Promise<void> {
  if (!userId) throw new Error("缺少成员信息，无法保存周报");
  await settingsRepo.set(reviewKey(userId, weekMonday), JSON.stringify(entry));
}

export async function loadReview(userId: string, weekMonday: string): Promise<StoredReview | null> {
  if (!userId) return null;
  const raw = await settingsRepo.get(reviewKey(userId, weekMonday));
  if (!raw) return null;
  try { return JSON.parse(raw) as StoredReview; } catch { return null; }
}
