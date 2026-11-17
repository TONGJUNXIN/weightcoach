/**
 * AI 饮食建议（FR-AI-04 A.3）：按已算好的目标与疾病约束生成 3 餐+1 加餐/四类替换/外食策略。
 * 失败降级为本地规则生成的建议，不承诺疗效；不做三餐记录与依从率。
 */
import { useState } from "react";
import { dietPrompt } from "@/domain/ai";
import { localDiet, type DietOutput } from "@/domain/aiSchemas";
import type { DietTargets } from "@/domain/diet";
import { Button, Card, useToast } from "@/components/ui";
import { callAi } from "@/lib/aiService";

interface Props {
  userId: string;
  userName: string;
  targets: DietTargets;
  diseases: string[];
}

export function DietAiCard({ userId, userName, targets, diseases }: Props) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<DietOutput | null>(null);
  const [source, setSource] = useState<"ai" | "local" | null>(null);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await callAi<DietOutput>({
        task: "diet",
        userId,
        userPrompt: dietPrompt({
          userName,
          intakeKcal: targets.energy,
          proteinG: targets.proteinG,
          fatG: targets.fatG,
          carbG: targets.carbG,
          diseases,
          avoid: "",
          taste: "",
          eatingOut: "",
        }),
        fallback: localDiet(targets),
      });
      setOutput(res.data ?? localDiet(targets));
      setSource(res.source);
      if (res.error) show(res.error.message, "error");
    } catch (e) {
      setOutput(localDiet(targets));
      setSource("local");
      show(e instanceof Error ? e.message : "生成失败", "error");
    } finally { setBusy(false); }
  };

  return (
    <Card title="AI 饮食建议（可选）" action={
      <Button variant="secondary" disabled={busy} onClick={() => void generate()}>
        {busy ? "生成中…" : "生成 AI 建议"}
      </Button>
    }>
      {!output ? (
        <p className="text-sm text-muted">按你的摄入目标与登记疾病，生成一周餐次模板、等份替换与外食策略；未启用时自动用本地规则。</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="text-xs text-muted">来源：{source === "ai" ? "AI 版" : "本地版（降级）"} · 估算值，不承诺疗效；有疾病或用药请遵医嘱。</div>
          <div className="space-y-1">
            {output.meals.map((m, i) => (
              <div key={i} className="rounded-lg bg-bg px-3 py-2">
                <span className="font-medium">{m.name}：</span>{m.foods}{m.note ? `（${m.note}）` : ""}
              </div>
            ))}
          </div>
          {output.swaps.length > 0 && (
            <div>
              <div className="font-medium">等份替换</div>
              <ul className="list-disc pl-5 text-muted">{output.swaps.map((s, i) => <li key={i}>{s.category}：{s.options}</li>)}</ul>
            </div>
          )}
          {output.eating_out.length > 0 && (
            <div>
              <div className="font-medium">外食策略</div>
              <ul className="list-disc pl-5 text-muted">{output.eating_out.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-muted">{output.disclaimer}</p>
        </div>
      )}
    </Card>
  );
}
