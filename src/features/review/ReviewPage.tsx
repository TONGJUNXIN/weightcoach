import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Activity, ChevronLeft, ChevronRight, ClipboardCheck, FlaskConical, Pill,
  Ruler, Save, Scale,
} from "lucide-react";
import {
  Badge, Button, Card, Empty, Modal, PageHeader, useToast,
} from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { aggregateWeek, summarizeWeek } from "@/domain/review";
import { exerciseRepo, medicationLogRepo, reviewRepo } from "@/db/repositories";
import { addDays, fmtDate, mondayStart, parseDate, prevWeekRange, fourWeeksAgoRange } from "@/lib/date";
import { loadReview, saveReview, type StoredReview } from "@/lib/reviewStore";
import { ReviewAiCard } from "./ReviewAiCard";
import { AiReasonButton } from "@/features/ai/AiReasonButton";
import { plateauPrompt } from "@/domain/ai";

type TraceKind = "weight" | "waist" | "exercise" | "adherence" | "indicator" | "logging";

/** S09 周复盘（SRS FR-REV-04/05/06/07）：六项 + 追溯 + 中性总结 + 历史周。 */
export function ReviewPage() {
  const { user } = useUser();
  const userId = user?.id ?? "";
  const navigate = useNavigate();
  const { show } = useToast();
  const [weekOffset, setWeekOffset] = useState(0); // 0=上周，-1=上上周…
  const [trace, setTrace] = useState<TraceKind | null>(null);
  const [stored, setStored] = useState<StoredReview | null>(null);

  const thisMon = mondayStart(new Date());
  const targetMon = addDays(thisMon, (weekOffset - 1) * 7);
  const weekFrom = fmtDate(targetMon);
  const weekTo = fmtDate(addDays(targetMon, 6));
  const prev = weekOffset === 0 ? prevWeekRange() : {
    from: fmtDate(addDays(targetMon, -7)), to: fmtDate(addDays(targetMon, -1)),
  };

  const { data: report, isLoading } = useQuery({
    queryKey: ["review", userId, weekFrom],
    enabled: !!userId,
    queryFn: async () => {
      const saved = await loadReview(userId, fmtDate(targetMon));
      if (saved) return saved.report;
      const [measurements, prevMeasurements, waists, exerciseDays, planSessions, adherence, indicators, loggedDays] = await Promise.all([
        reviewRepo.measurements(userId, weekFrom, weekTo),
        reviewRepo.measurements(userId, prev.from, prev.to),
        reviewRepo.waists(userId, weekFrom, weekTo),
        reviewRepo.exerciseDays(userId, weekFrom, weekTo),
        reviewRepo.planSessions(userId, weekFrom, weekTo),
        reviewRepo.adherence(userId, weekFrom, weekTo),
        reviewRepo.indicators(userId, weekFrom, weekTo),
        reviewRepo.loggedDays(userId, weekFrom, weekTo),
      ]);
      const four = fourWeeksAgoRange(parseDate(weekFrom));
      const waistBase = await reviewRepo.waists(userId, four.from, four.to);
      return aggregateWeek({
        measurements, prevMeasurements, waists,
        waistFourWeeksAgo: waistBase, exerciseDays, planSessions,
        takenSlots: adherence.taken, dueSlots: adherence.due,
        indicators, loggedDays,
      }, weekFrom, weekTo);
    },
  });

  useEffect(() => {
    if (!userId) return;
    void loadReview(userId, fmtDate(targetMon)).then(setStored);
  }, [userId, targetMon]);

  useEffect(() => {
    if (!report || stored || !userId) return;
    void saveReview(userId, fmtDate(targetMon), {
      report, summary: summarizeWeek(report), generatedAt: new Date().toISOString(), source: "local",
    }).then(() => setStored({ report, summary: summarizeWeek(report), generatedAt: new Date().toISOString(), source: "local" }));
  }, [report, stored, userId, targetMon]);

  const summary = report ? (stored?.summary ?? summarizeWeek(report)) : "";

  const saveSnapshot = async () => {
    if (!report) return;
    try {
      await saveReview(userId, fmtDate(targetMon), {
        report, summary: summarizeWeek(report), generatedAt: new Date().toISOString(), source: "local",
      });
      setStored(await loadReview(userId, fmtDate(targetMon)));
      show("周报快照已保存");
    } catch { show("保存失败", "error"); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="WEEKLY REVIEW"
        title="周复盘"
        subtitle={`${user?.display_name ?? "成员"} · ${weekFrom} ~ ${weekTo}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setWeekOffset((o) => o + 1)}>
              <ChevronLeft size={13} /> 更早
            </Button>
            <Button variant="secondary" size="sm" disabled={weekOffset <= 0} onClick={() => setWeekOffset((o) => o - 1)}>
              较近 <ChevronRight size={13} />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void saveSnapshot()}>
              <Save size={13} /> 保存快照
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="rounded-2xl border border-line/80 bg-paper p-8 text-center text-sm text-muted shadow-soft">正在汇总这一周…</div>
      ) : !report ? (
        <Card title="没有可复盘的记录" eyebrow="EMPTY">
          <Empty text="上周还没有足够记录，先去记两天。" />
          <div className="flex justify-center"><Button onClick={() => navigate("/today")}>回到今日</Button></div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <Badge tone={stored?.source === "ai" ? "coral" : "teal"}>{stored?.source === "ai" ? "AI 版" : "本地版"}</Badge>
            {stored && <span>生成于 {new Date(stored.generatedAt).toLocaleString("zh-CN")}</span>}
            <span>·</span>
            <span>数字点开可追溯原始记录</span>
          </div>

          {report.insufficientData && (
            <div className="rounded-2xl border border-accent/20 bg-accent-soft px-4 py-3 text-[11px] text-accent">
              本周记录不足（体重记录 {report.weightRecordDays} 天 / 应服时段 {report.adherenceDue}），以下结论仅供参考。
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 min-[1000px]:grid-cols-3">
            <MetricCard
              icon={<Scale size={16} />} label="体重变化"
              value={report.weightChange == null ? "样本不足" : `${report.weightChange > 0 ? "+" : ""}${report.weightChange.toFixed(1)} kg`}
              sub={report.weightAvg == null ? "无均值" : `7 日均值 ${report.weightAvg.toFixed(1)} kg`}
              tone={report.weightChange == null ? "muted" : report.weightChange <= 0 ? "good" : "warn"}
              onClick={() => setTrace("weight")}
            />
            <MetricCard
              icon={<Ruler size={16} />} label="腰围变化"
              value={report.waistChange == null ? "暂无对比" : `${report.waistChange > 0 ? "+" : ""}${report.waistChange.toFixed(1)} cm`}
              sub={report.waistLatest == null ? "无记录" : `最近 ${report.waistLatest.toFixed(1)} cm`}
              tone="muted"
              onClick={() => setTrace("waist")}
            />
            <MetricCard
              icon={<Activity size={16} />} label="运动天数"
              value={`${report.exerciseDays} 天`}
              sub={`本周计划 ${report.planSessions} 项`}
              tone="good"
              onClick={() => setTrace("exercise")}
            />
            <MetricCard
              icon={<Pill size={16} />} label="用药依从"
              value={report.adherenceDue === 0 ? "样本不足" : `${report.adherenceRate}%`}
              sub={`${report.adherenceTaken}/${report.adherenceDue} 时段`}
              tone={report.adherenceRate >= 80 ? "good" : "warn"}
              onClick={() => setTrace("adherence")}
            />
            <MetricCard
              icon={<FlaskConical size={16} />} label="指标变化"
              value={`${report.indicatorChanges.length} 项`}
              sub="点击查看每次测量"
              tone="muted"
              onClick={() => setTrace("indicator")}
            />
            <MetricCard
              icon={<ClipboardCheck size={16} />} label="记录完成率"
              value={`${report.loggingRate}%`}
              sub={`有记录 ${Math.round(report.loggingRate / 100 * 7)}/7 天`}
              tone={report.loggingRate >= 70 ? "good" : "warn"}
              onClick={() => setTrace("logging")}
            />
          </div>

          <Card title="本周事实总结" eyebrow="FACTS ONLY" action={<Badge tone="muted">本地生成 · 不判断好坏</Badge>}>
            <p className="text-[13px] leading-7 text-text">{summary}</p>
          </Card>

          <ReviewAiCard
            report={report}
            userId={userId}
            weekMonday={fmtDate(targetMon)}
            userName={user?.display_name ?? "成员"}
            current={stored}
            onSaved={() => void loadReview(userId, fmtDate(targetMon)).then(setStored)}
          />

          <Card title="平台期归因" eyebrow="AI OPTIONAL" action={<Badge tone="muted">可选</Badge>}>
            <p className="mb-3 text-[11px] leading-relaxed text-muted">
              体重变化放缓时，从记录事实中找可能因素；不做诊断，不推荐药品或极端饮食。
            </p>
            <AiReasonButton
              task="plateau"
              userId={userId}
              userPrompt={plateauPrompt(JSON.stringify({
                weight: { avg: report.weightAvg, prevAvg: report.weightPrev, change: report.weightChange },
                exercise: { days: report.exerciseDays, planned: report.planSessions },
                medication: { taken: report.adherenceTaken, due: report.adherenceDue },
                logging: { rate: report.loggingRate },
              }))}
              fallbackText="体重变化受多因素影响，请结合运动、用药与记录情况综合看待；本工具不做医学判断。"
              label="归因分析"
            />
          </Card>
        </>
      )}

      {trace && <TraceModal kind={trace} userId={userId} from={weekFrom} to={weekTo} onClose={() => setTrace(null)} />}
    </div>
  );
}

function MetricCard({ icon, label, value, sub, tone, onClick }: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "good" | "warn" | "muted";
  onClick: () => void;
}) {
  const valueTone = tone === "good" ? "text-primary" : tone === "warn" ? "text-accent" : "text-ink";
  return (
    <button onClick={onClick} className="card-hover rounded-2xl border border-line/80 bg-paper p-4 text-left shadow-soft">
      <div className="flex items-center justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${tone === "good" ? "bg-primary-soft text-primary" : tone === "warn" ? "bg-accent-soft text-accent" : "bg-bg text-muted"}`}>
          {icon}
        </span>
        <span className="text-[9px] text-muted">查看 →</span>
      </div>
      <div className="mt-3 text-[9px] font-medium uppercase tracking-[1.5px] text-muted">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold tracking-[-.5px] ${valueTone}`}>{value}</div>
      <div className="mt-1 truncate text-[10px] text-muted">{sub}</div>
    </button>
  );
}

function TraceModal({ kind, userId, from, to, onClose }: { kind: TraceKind; userId: string; from: string; to: string; onClose: () => void }) {
  const [rows, setRows] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        let out: string[] = [];
        switch (kind) {
          case "weight": out = (await reviewRepo.measurements(userId, from, to)).map((r) => `${r.date} · ${r.weightKg} kg`); break;
          case "waist": out = (await reviewRepo.waists(userId, from, to)).map((r) => `${r.date} · ${r.waistCm} cm`); break;
          case "exercise": out = (await exerciseRepo.list(userId)).filter((r) => r.logged_on >= from && r.logged_on <= to).map((r) => `${r.logged_on} · ${r.did_exercise === 1 ? "已运动" : "未运动"}${r.note ? ` · ${r.note}` : ""}`); break;
          case "adherence": {
            const a = await medicationLogRepo.adherence(userId, from, to);
            out = [`已打卡 ${a.taken} / 应服 ${a.scheduled} 时段（按每日时段展开）`];
            break;
          }
          case "indicator": out = (await reviewRepo.indicators(userId, from, to)).map((r) => `${r.date} · ${r.name} ${r.value} ${r.unit}`); break;
          case "logging": {
            const dates = await reviewRepo.loggedDates(userId, from, to);
            out = dates.map((d) => `${d} · 有记录`);
            break;
          }
        }
        setRows(out.length ? out : ["本周无原始记录"]);
      } catch { setRows(["读取失败"]); }
      setLoaded(true);
    })();
  }, [kind, userId, from, to]);

  const titles: Record<TraceKind, string> = {
    weight: "体重原始记录", waist: "腰围原始记录", exercise: "运动打卡记录",
    adherence: "用药打卡汇总", indicator: "指标测量记录", logging: "有记录的日子",
  };
  return (
    <Modal title={titles[kind]} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      {!loaded ? <p className="py-4 text-sm text-muted">读取中…</p> : (
        <div className="max-h-[340px] space-y-1 overflow-auto">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl bg-bg px-3 py-2 text-[12px] text-text">{r}</div>
          ))}
        </div>
      )}
    </Modal>
  );
}
