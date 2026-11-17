/**
 * 周复盘 AI 解读（FR-AI-04 A.2 / FR-REV-07）：组装快照 → callAi(review) →
 * 展示结构化解读（本地版/AI 版标注）→ 保存 AI 版周报；非法 JSON 由 service 降级。
 */
import { useState } from "react";
import { reviewPrompt } from "@/domain/ai";
import { localReview, type ReviewOutput } from "@/domain/aiSchemas";
import type { WeekReport } from "@/domain/review";
import { Button, Card, useToast } from "@/components/ui";
import { diseaseRepo, goalRepo, profileRepo } from "@/db/repositories";
import { callAi } from "@/lib/aiService";
import { saveReview, type StoredReview } from "@/lib/reviewStore";

interface Props {
  report: WeekReport;
  userId: string;
  weekMonday: string;
  userName: string;
  current: StoredReview | null;
  onSaved: () => void;
}

/** 按 A.2 组装数据快照：只放可溯源数字与事实 */
async function buildSnapshot(userId: string, report: WeekReport) {
  const [profile, goal, diseases] = await Promise.all([
    profileRepo.get(userId),
    goalRepo.get(userId),
    diseaseRepo.list(userId),
  ]);
  const age = profile?.birth_year ? new Date().getFullYear() - profile.birth_year : null;
  return {
    profile: { sex: profile?.sex ?? "", age, heightCm: profile?.height_cm ?? null, activity: profile?.activity_level ?? "" },
    goal: goal ? { targetWeightKg: goal.target_weight_kg, dailyDeficit: goal.daily_deficit_kcal } : null,
    weight: { avg: report.weightAvg, prevAvg: report.weightPrev, days: report.weightRecordDays },
    waist: { latest: report.waistLatest, change4w: report.waistChange },
    exercise: { days: report.exerciseDays, plannedSessions: report.planSessions },
    medication: { taken: report.adherenceTaken, due: report.adherenceDue },
    indicators: report.indicatorChanges.map((c) => ({ name: c.name, value: c.to, unit: c.unit, date: c.toDate })),
    diseases: diseases.map((d) => d.name),
  };
}

export function ReviewAiCard({ report, userId, weekMonday, userName, current, onSaved }: Props) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<ReviewOutput | null>(null);
  const [source, setSource] = useState<"ai" | "local" | null>(current?.source ?? null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const snapshot = await buildSnapshot(userId, report);
      const res = await callAi<ReviewOutput>({
        task: "review",
        userId,
        userPrompt: reviewPrompt({
          userName, weekStart: report.weekStart, weekEnd: report.weekEnd,
          snapshot: JSON.stringify(snapshot),
        }),
        fallback: localReview(report),
      });
      const data = res.data ?? localReview(report);
      setOutput(data);
      setSource(res.source);
      if (res.error) setErrorMsg(res.error.message);
      // 保存 AI 版（若降级则仍记 local，不冒充 AI）
      await saveReview(userId, weekMonday, {
        report,
        summary: data.week_summary.weight + data.week_summary.exercise,
        generatedAt: new Date().toISOString(),
        source: res.source,
      });
      onSaved();
      show(res.source === "ai" ? "AI 解读已生成并保存" : "已使用本地版本并保存", res.source === "ai" ? "info" : "error");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "生成失败，请稍后重试。");
    } finally { setBusy(false); }
  };

  return (
    <Card title="AI 解读" action={
      <Button variant="secondary" disabled={busy} onClick={() => void generate()}>
        {busy ? "生成中…" : "生成 AI 解读"}
      </Button>
    }>
      {errorMsg && <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{errorMsg}</div>}
      {!output ? (
        <p className="text-sm text-muted">
          点击「生成 AI 解读」可获得本周解释与下周关注点；未启用或失败时自动使用本地事实总结。
          {current && ` 当前周报来源：${current.source === "ai" ? "AI 版" : "本地版"}。`}
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="text-xs text-muted">来源：{source === "ai" ? "AI 版" : "本地版（降级）"}</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(output.week_summary).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-bg px-3 py-2">
                <div className="text-xs text-muted">{{ weight: "体重", waist: "腰围", exercise: "运动", medication: "用药", indicators: "指标" }[k] ?? k}</div>
                <div className="mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          {output.highlights.length > 0 && (
            <div><div className="font-medium">亮点</div><ul className="list-disc pl-5 text-muted">{output.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
          )}
          {output.concerns.length > 0 && (
            <div><div className="font-medium">关注</div><ul className="list-disc pl-5 text-muted">{output.concerns.map((c, i) => <li key={i}>[{c.level}] {c.text}</li>)}</ul></div>
          )}
          {(output.next_week.exercise_focus || output.next_week.diet_focus || output.next_week.tips.length > 0) && (
            <div className="rounded-lg border border-border p-3">
              <div className="font-medium">下周关注</div>
              {output.next_week.exercise_focus && <p className="text-muted">运动：{output.next_week.exercise_focus}</p>}
              {output.next_week.diet_focus && <p className="text-muted">饮食：{output.next_week.diet_focus}</p>}
              {output.next_week.tips.length > 0 && <ul className="list-disc pl-5 text-muted">{output.next_week.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>
          )}
          <p className="text-xs text-muted">{output.disclaimer}</p>
        </div>
      )}
    </Card>
  );
}
