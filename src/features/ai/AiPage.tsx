/**
 * AI 问答页（S12 / FR-AI-04/08/10）：自由问答 + 调用历史 + 清空 + 未启用引导。
 * 发送前按 sendMeds/sendIndicators 开关裁剪快照；失败只显示状态条。
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Bot, MessageSquare, Sparkles, Trash2, User } from "lucide-react";
import { chatPrompt } from "@/domain/ai";
import { Badge, Button, Card, Empty, Input, PageHeader, useToast } from "@/components/ui";
import { useUser } from "@/app/UserContext";
import {
  aiRunRepo, goalRepo, indicatorRepo, measurementRepo, medicationRepo,
  profileRepo, settingsRepo, SETTINGS, type AiRunRow,
} from "@/db/repositories";
import { callAi, currentBudget, loadAiConfig } from "@/lib/aiService";

interface Msg { role: "user" | "assistant"; text: string; source?: "ai" | "local" }

/** 组装可分享的最小数据快照（FR-AI-08：药名/指标可关闭） */
async function buildSnapshot(userId: string, sendMeds: boolean, sendIndicators: boolean) {
  const [profile, goal, latest, meds, indicators] = await Promise.all([
    profileRepo.get(userId),
    goalRepo.get(userId),
    measurementRepo.latest(userId),
    sendMeds ? medicationRepo.list(userId) : Promise.resolve([]),
    sendIndicators ? indicatorRepo.list(userId) : Promise.resolve([]),
  ]);
  return {
    profile: profile ? { sex: profile.sex, birthYear: profile.birth_year, heightCm: profile.height_cm, activity: profile.activity_level } : null,
    goal: goal ? { targetWeightKg: goal.target_weight_kg, dailyDeficit: goal.daily_deficit_kcal } : null,
    latest: latest ? { weightKg: latest.weight_kg, waistCm: latest.waist_cm, date: latest.measured_on } : null,
    medication: sendMeds ? meds.map((m) => m.name) : "[已关闭发送药名]",
    indicators: sendIndicators ? indicators.slice(0, 10).map((i) => ({ name: i.name, value: i.value, unit: i.unit })) : "[已关闭发送指标]",
  };
}

const taskLabel: Record<string, string> = {
  review: "周复盘", diet: "饮食建议", pdf: "PDF 解析", planReason: "计划理由", plateau: "平台期归因", chat: "问答",
};

const SUGGESTIONS = ["这周运动安排怎么调整？", "体重不动了，先看哪些记录？", "外食时怎么选更稳？"];

export function AiPage() {
  const { user } = useUser();
  const { show } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: history = [], refetch: refetchHistory } = useQuery<AiRunRow[]>({
    queryKey: ["ai-history", user?.id],
    enabled: !!user?.id,
    queryFn: () => aiRunRepo.list(user!.id),
  });

  useEffect(() => {
    void settingsRepo.get(SETTINGS.aiEnabled).then((v) => setEnabled(v === "1"));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (raw: string) => {
    const q = raw.trim();
    if (!q || !user || busy) return;
    setInput("");
    setNotice(null);
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setBusy(true);
    try {
      const cfg = await loadAiConfig();
      const snapshot = await buildSnapshot(user.id, cfg.sendMeds, cfg.sendIndicators);
      if (!cfg.enabled) {
        setMessages((prev) => [...prev, { role: "assistant", text: "AI 还没启用，去设置里选一个服务商后可获得解释。", source: "local" }]);
        return;
      }
      let manual = false;
      let budgetConfirmed = false;
      const b = await currentBudget(cfg);
      if (b.verdict.kind === "blocked") {
        if (!window.confirm(`本月 AI 预算已用完（约 ¥${b.spent.toFixed(2)} / ¥${b.budget}）。仍要手动发送这一次吗？`)) {
          setMessages((prev) => [...prev, { role: "assistant", text: "已取消本次发送；本月预算已用完，本地记录与周报不受影响。", source: "local" }]);
          return;
        }
        manual = true;
        budgetConfirmed = true;
      }
      const res = await callAi<string>({
        task: "chat", userId: user.id,
        userPrompt: chatPrompt(q, JSON.stringify(snapshot)),
        fallback: "这次没拿到结果，请稍后重试；如需数据解读，请确认网络或检查 AI 设置。",
        manual, budgetConfirmed,
      });
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: res.text ?? res.error?.message ?? "这次没拿到结果，请稍后重试。",
        source: res.source,
      }]);
      if (res.source === "local") setNotice(res.error?.message ?? "已使用本地版本。");
      void refetchHistory();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败，请稍后重试。");
    } finally { setBusy(false); }
  };

  const clearHistory = async () => {
    if (!window.confirm("删除本机全部 AI 调用记录？此操作不可撤销。")) return;
    try {
      await aiRunRepo.clearAll();
      await refetchHistory();
      show("AI 历史已清空");
    } catch (e) { show(e instanceof Error ? e.message : "清空失败", "error"); }
  };

  const removeOne = async (id: string) => {
    try {
      await aiRunRepo.remove(id);
      await refetchHistory();
      show("已删除该条调用记录");
    } catch (e) { show(e instanceof Error ? e.message : "删除失败", "error"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI ASSISTANT"
        title="AI 问答"
        subtitle="只解释与建议，不做诊断或用药指导；数据仅在你主动发送时离开本机。"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setMessages([])}>清空对话</Button>
            <Button variant="secondary" size="sm" onClick={() => void clearHistory()}>清空历史</Button>
          </>
        }
      />

      {enabled === false && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-accent-soft px-4 py-3 text-[11px] text-accent">
          <span>AI 还没启用，本地记录与周报不受影响。</span>
          <Link to="/settings" className="font-semibold underline">去设置里选一个服务商</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-[1fr_300px]">
        <Card title="对话" eyebrow="CHAT" action={<Badge tone="muted">不写入长期档案</Badge>}>
          <div className="flex h-[500px] flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Sparkles size={22} /></span>
                  <p className="mt-3 text-[13px] font-medium text-ink">问一个和你记录有关的问题</p>
                  <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted">它会读取你允许发送的档案、体重、运动与用药摘要；不发送原始记录全文。</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => void send(s)} className="rounded-full border border-line/80 bg-paper px-3 py-1.5 text-[10px] text-muted transition-colors hover:border-primary/30 hover:text-primary">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Bot size={14} /></span>
                  )}
                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed ${
                    m.role === "user" ? "bg-primary text-white" : "border border-line/60 bg-[#FBF9F5] text-text"
                  }`}>
                    {m.text}
                    {m.role === "assistant" && (
                      <div className={`mt-1.5 text-[8.5px] ${m.source === "local" ? "text-accent" : "text-muted"}`}>
                        {m.source === "local" ? "本地版本 · 未调用模型" : "AI 生成 · 仅供参考"}
                      </div>
                    )}
                  </div>
                  {m.role === "user" && (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg text-muted"><User size={14} /></span>
                  )}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-[10px] text-muted">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-primary"><Bot size={14} /></span>
                  正在整理你的记录…
                </div>
              )}
              <div ref={endRef} />
            </div>

            {notice && <div className="mt-2 rounded-xl bg-accent-soft px-3 py-2 text-[10px] text-accent">{notice}</div>}

            <div className="mt-3 rounded-2xl border border-line/80 bg-paper p-2 focus-within:border-primary/40">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                placeholder="输入问题，回车发送"
                disabled={busy}
                className="border-0 bg-transparent px-1 shadow-none focus:ring-0"
              />
              <div className="flex items-center justify-between px-1 pb-0.5 pt-1">
                <span className="text-[9px] text-muted">Enter 发送 · Shift + Enter 换行</span>
                <Button size="sm" onClick={() => void send(input)} disabled={busy || !input.trim()}>
                  <ArrowUp size={14} /> {busy ? "发送中" : "发送"}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="最近调用" eyebrow="LOG" action={<Badge tone="muted">{history.length}</Badge>}>
          {history.length === 0 ? (
            <Empty text="暂无调用记录（最多保留最近 100 次）" />
          ) : (
            <div className="max-h-[500px] space-y-2 overflow-auto pr-1">
              {history.map((r) => (
                <div key={r.id} className="rounded-xl border border-line/60 bg-[#FBF9F5] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-medium text-ink">
                      <MessageSquare size={11} className="text-primary" /> {taskLabel[r.task] ?? r.task}
                    </span>
                    <button aria-label="删除记录" className="text-muted hover:text-danger" onClick={() => void removeOne(r.id)}><Trash2 size={11} /></button>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted">
                    <span className={`h-1.5 w-1.5 rounded-full ${r.status === "ok" ? "bg-primary" : r.status === "local" ? "bg-gold" : "bg-danger"}`} />
                    {r.status === "ok" ? "成功" : r.status === "local" ? "本地" : `失败 ${r.error_code ?? ""}`}
                    <span>·</span><span>{r.provider}</span>
                    {r.cost_cny != null && <><span>·</span><span>¥{r.cost_cny.toFixed(3)}</span></>}
                  </div>
                  <div className="mt-0.5 text-[8.5px] text-muted/70">{new Date(r.created_at).toLocaleString("zh-CN")}</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 border-t border-line/60 pt-2 text-[9px] leading-relaxed text-muted">只记录任务、供应商、状态与估算费用，不保存对话正文。</p>
        </Card>
      </div>
    </div>
  );
}
