/**
 * 通用「一句话 AI 解释」按钮（FR-AI-04 计划理由 / 平台期归因）：
 * 结构化任务走 ReasonSchema，失败自动降级本地文本，AI 关闭不发网络请求。
 */
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import type { TaskId } from "@/domain/ai";
import { localReason, type ReasonOutput } from "@/domain/aiSchemas";
import { callAi, currentBudget } from "@/lib/aiService";

interface Props {
  task: Extract<TaskId, "planReason" | "plateau">;
  userId: string;
  userPrompt: string;
  fallbackText: string;
  label?: string;
}

export function AiReasonButton({ task, userId, userPrompt, fallbackText, label = "AI 解释" }: Props) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [local, setLocal] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      let manual = false;
      let budgetConfirmed = false;
      const b = await currentBudget();
      if (b.verdict.kind === "blocked") {
        if (!window.confirm(`本月 AI 预算已用完（约 ¥${b.spent.toFixed(2)} / ¥${b.budget}）。仍要手动生成这一次吗？`)) {
          setLocal(true);
          setText("已取消生成；本月预算已用完，本地版本仍可查看。");
          return;
        }
        manual = true;
        budgetConfirmed = true;
      }
      const res = await callAi<ReasonOutput>({
        task, userId, userPrompt,
        fallback: localReason(fallbackText),
        manual, budgetConfirmed,
      });
      setText(res.data?.text ?? res.error?.message ?? fallbackText);
      setLocal(res.source === "local");
      if (res.error) show(res.error.message, "error");
    } catch (e) {
      setText(fallbackText);
      setLocal(true);
      show(e instanceof Error ? e.message : "生成失败", "error");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={busy} onClick={() => void run()}>{busy ? "生成中…" : label}</Button>
      {text && (
        <p className="rounded-lg bg-bg px-3 py-2 text-sm text-muted">
          {text}{local && <span className="ml-2 text-xs">（本地版本）</span>}
        </p>
      )}
    </div>
  );
}
