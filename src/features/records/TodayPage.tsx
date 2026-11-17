import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Pill, Scale, Activity } from "lucide-react";
import {
  Avatar, Badge, Button, Card, Empty, PageHeader, Progress, SectionTitle,
} from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { calcGoalPeriod } from "@/domain/energy";
import {
  exerciseRepo, goalRepo, medicationLogRepo, planRepo, profileRepo, trendRepo,
} from "@/db/repositories";
import { addDays, fmtDate, mondayStart } from "@/lib/date";
import { select, todayStr } from "@/db/client";
import type { WeightPoint } from "@/db/types";
import { WeightModal } from "./WeightModal";

interface FamilyStatus {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  weighed: boolean;
  exercised: boolean;
  medicationDone: boolean;
  medicationTotal: number;
}

const WINDOW_DAYS = 29;

export function TodayPage() {
  const { user } = useUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [weightOpen, setWeightOpen] = useState(false);
  const userId = user?.id ?? "";
  const today = todayStr();
  const now = new Date();
  const weekStart = fmtDate(mondayStart(now));
  const weekIndex = (now.getDay() + 6) % 7;
  const hour = now.getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  useEffect(() => {
    const refresh = () => { void qc.invalidateQueries(); };
    window.addEventListener("weightcoach:refresh", refresh);
    return () => window.removeEventListener("weightcoach:refresh", refresh);
  }, [qc]);

  const { data: goal } = useQuery({
    queryKey: ["goal", userId], enabled: !!userId, queryFn: () => goalRepo.get(userId),
  });
  const { data: profile } = useQuery({
    queryKey: ["profile", userId], enabled: !!userId, queryFn: () => profileRepo.get(userId),
  });
  const { data: points = [] } = useQuery<WeightPoint[]>({
    queryKey: ["trend", "weight", userId, "30", goal?.target_weight_kg],
    enabled: !!userId,
    queryFn: () => trendRepo.weightPoints(
      userId,
      fmtDate(addDays(new Date(), -WINDOW_DAYS)),
      today,
      goal?.target_weight_kg ?? null,
    ),
  });
  const { data: todayExercise } = useQuery({
    queryKey: ["exercise", "today", userId, today], enabled: !!userId,
    queryFn: () => exerciseRepo.get(userId, today),
  });
  const { data: due = [] } = useQuery({
    queryKey: ["med-due", userId, today], enabled: !!userId,
    queryFn: () => medicationLogRepo.dueToday(userId, today),
  });
  const { data: savedPlan } = useQuery({
    queryKey: ["plan", userId, weekStart], enabled: !!userId,
    queryFn: () => planRepo.get(userId, weekStart),
  });
  const { data: family = [] } = useQuery({
    queryKey: ["family-status", today],
    queryFn: async () => {
      const rows = await select<{ id: string; display_name: string; color: string; avatar_data: string | null }>(
        "SELECT id, display_name, color, avatar_data FROM users WHERE archived_at IS NULL ORDER BY created_at",
      );
      const result: FamilyStatus[] = [];
      for (const row of rows) {
        const [weighed, exercised, slots] = await Promise.all([
          select<{ n: number }>("SELECT COUNT(*) AS n FROM measurements WHERE user_id = ? AND measured_on = ?", [row.id, today]),
          select<{ n: number }>("SELECT COUNT(*) AS n FROM exercise_logs WHERE user_id = ? AND logged_on = ?", [row.id, today]),
          select<{ n: number; done: number }>(
            `SELECT COUNT(*) AS n, SUM(CASE WHEN l.status = 'taken' THEN 1 ELSE 0 END) AS done
             FROM medication_slots s LEFT JOIN medication_logs l
               ON l.slot_id = s.id AND l.log_date = ?
             JOIN medications m ON m.id = s.medication_id AND m.user_id = ? AND m.active = 1`,
            [today, row.id],
          ),
        ]);
        result.push({
          id: row.id,
          name: row.display_name,
          color: row.color,
          avatar: row.avatar_data,
          weighed: (weighed[0]?.n ?? 0) > 0,
          exercised: (exercised[0]?.n ?? 0) > 0,
          medicationDone: (slots[0]?.n ?? 0) > 0 && (slots[0]?.done ?? 0) === slots[0]?.n,
          medicationTotal: slots[0]?.n ?? 0,
        });
      }
      return result;
    },
  });

  const latest = points.length ? points[points.length - 1] : null;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const delta = latest && previous ? Math.round((latest.weight - previous.weight) * 10) / 10 : null;
  const avg7 = points.length
    ? Math.round((points.slice(-7).reduce((s, p) => s + p.weight, 0) / Math.min(7, points.length)) * 10) / 10
    : null;
  const period = latest && goal && profile
    ? calcGoalPeriod(latest.weight, goal.target_weight_kg, profile.height_cm)
    : null;
  const startWeight = points.length ? (points[0]?.weight ?? null) : null;
  const progress = latest && goal && startWeight && startWeight > goal.target_weight_kg
    ? ((startWeight - latest.weight) / (startWeight - goal.target_weight_kg)) * 100
    : 0;
  const remaining = latest && goal ? Math.max(0, latest.weight - goal.target_weight_kg) : null;

  const me = family.find((f) => f.id === user?.id);
  const medTaken = due.filter((d) => d.status === "taken").length;
  const medDone = !!me && (me.medicationTotal === 0 || me.medicationDone);
  const doneCount = (me?.weighed ? 1 : 0) + (todayExercise ? 1 : 0) + (medDone ? 1 : 0);
  const loggedDays = new Set(points.filter((p) => p.date >= weekStart).map((p) => p.date)).size;
  const planItems = savedPlan?.items ?? [];
  const planDone = planItems.filter((i) => i.status === "done").length;
  const weekDays = Array.from({ length: 7 }, (_, i) => fmtDate(addDays(mondayStart(now), i)));

  const actions = (
    <>
      <Badge tone="muted">本周第 {weekIndex + 1} 天</Badge>
      <Button variant="secondary" size="sm" onClick={() => navigate("/trends")}>
        看趋势 <ArrowRight size={13} />
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`星期${["日", "一", "二", "三", "四", "五", "六"][now.getDay()]} · ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`}
        title={<>{greeting}，<span className="text-primary">{user?.display_name ?? "你"}</span>。今天也慢慢来。</>}
        actions={actions}
      />

      <div className="flex flex-col gap-4 min-[1200px]:flex-row">
        <section className="relative min-w-0 overflow-hidden rounded-3xl border border-line/70 bg-gradient-to-br from-white via-white to-[#FFF3E8] p-6 shadow-card min-[1200px]:w-[55%]">
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(circle,#EAF2EF_0%,rgba(234,242,239,0)_68%)]" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[2px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              今天的体重
            </div>
            {latest ? (
              <>
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <span className="tabular text-[64px] font-semibold leading-[.92] tracking-[-3px] text-ink">
                    {latest.weight.toFixed(1)}
                  </span>
                  <span className="mb-2 text-[15px] font-medium text-muted">kg</span>
                  {delta != null && (
                    <Badge tone={delta <= 0 ? "teal" : "coral"} className="mb-2">
                      {delta <= 0 ? "↓" : "↑"} {Math.abs(delta).toFixed(1)} kg
                    </Badge>
                  )}
                </div>
                <div className="mt-2 text-[11px] text-muted">
                  7 日均值 {avg7?.toFixed(1) ?? "—"} kg · 最近一次 {latest.date}
                </div>
                <Sparkline points={points.slice(-14)} />
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                  <span>目标 {goal?.target_weight_kg.toFixed(1) ?? "—"} kg</span>
                  <span>{remaining != null ? `还差 ${remaining.toFixed(1)} kg` : "—"}</span>
                </div>
                <Progress value={progress} className="mt-2" />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted/80">
                  <span>{period ? `预计 ${period.weeksFast}–${period.weeksSlow} 周` : "设置目标后显示周期"}</span>
                  <span>{period ? `${period.etaStart} ~ ${period.etaEnd}` : ""}</span>
                </div>
              </>
            ) : (
              <div className="py-10">
                <Empty text="还没有记录，先称一次吧。" />
                <div className="flex justify-center">
                  <Button onClick={() => setWeightOpen(true)}>＋ 记体重</Button>
                </div>
              </div>
            )}
          </div>
        </section>

        <Card
          title="今日待办"
          eyebrow="TODAY"
          action={<Badge tone={doneCount === 3 ? "teal" : "coral"}>{doneCount}/3</Badge>}
          className="flex min-w-0 flex-col min-[1200px]:flex-1"
        >
          <div className="space-y-2.5">
            <TaskRow
              icon={<Scale size={15} />}
              title="晨起称重"
              detail={me?.weighed ? `${latest?.weight.toFixed(1) ?? "—"} kg · 已记录` : "今天还没有记录"}
              done={!!me?.weighed}
              onClick={() => setWeightOpen(true)}
            />
            <TaskRow
              icon={<Activity size={15} />}
              title="运动打卡"
              detail={todayExercise ? (todayExercise.did_exercise === 1 ? "今天运动了" : "今天没运动") : "只记是 / 否，不记消耗"}
              done={!!todayExercise}
              onClick={() => navigate("/records")}
            />
            <TaskRow
              icon={<Pill size={15} />}
              title="晚间用药"
              detail={me?.medicationTotal === 0 ? "暂无用药" : `${medTaken}/${due.length} 已打卡`}
              done={medDone}
              onClick={() => navigate("/medications")}
            />
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-line/70 pt-3 text-[10px] text-muted">
            <span>本周记录 {loggedDays}/7 天</span>
            <button className="font-medium text-primary hover:underline" onClick={() => navigate("/records")}>
              去记录 →
            </button>
          </div>
        </Card>
      </div>

      <section>
        <SectionTitle
          title="本周计划"
          action={<button className="text-[11px] font-medium text-primary hover:underline" onClick={() => navigate("/plan")}>完整安排 →</button>}
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 min-[1500px]:grid-cols-7">
          {weekDays.map((date, i) => {
            const item = planItems.find((p) => p.plan_date === date);
            const isToday = date === today;
            const done = item?.status === "done";
            return (
              <button
                key={date}
                onClick={() => navigate("/plan")}
                className={`min-h-[92px] rounded-2xl border p-3 text-left transition-colors ${
                  isToday
                    ? "border-primary bg-gradient-to-b from-primary-soft/80 to-white shadow-soft"
                    : "border-line/80 bg-paper hover:border-primary/25"
                }`}
              >
                <div className="flex items-center justify-between text-[9px] uppercase tracking-[1px] text-muted">
                  <span>周{["一", "二", "三", "四", "五", "六", "日"][i]}</span>
                  {isToday && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[8px] text-white">今天</span>}
                </div>
                <div className={`mt-1 text-[15px] font-semibold ${isToday ? "text-primary" : "text-ink"}`}>{date.slice(8)}</div>
                <div className="mt-1 truncate text-[10px] text-muted">
                  {item ? `${item.mode} ${item.minutes > 0 ? `${item.minutes}m` : ""}` : "未安排"}
                </div>
                <div className={`mt-1 text-[9px] ${done ? "text-primary" : item ? "text-muted" : "text-muted/60"}`}>
                  {done ? "✓ 已完成" : item?.status === "skipped" ? "已跳过" : item ? "待完成" : "—"}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted">
          <span>完成 {planDone}/{planItems.length || 0} 项</span>
          <span>计划由天气与禁忌生成，不计算消耗</span>
        </div>
      </section>

      <section>
        <SectionTitle
          title="家庭状态"
          action={<button className="text-[11px] font-medium text-primary hover:underline" onClick={() => navigate("/users")}>管理成员 →</button>}
        />
        <div className="grid grid-cols-3 gap-2.5">
          {family.map((f) => (
            <div key={f.id} className="flex items-center gap-2.5 rounded-2xl border border-line/80 bg-paper px-3.5 py-3 shadow-soft">
              <Avatar name={f.name} color={f.color} src={f.avatar} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-ink">{f.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px] text-muted">
                  <span className={f.weighed ? "text-primary" : ""}>称重 {f.weighed ? "✓" : "—"}</span>
                  <span className={f.exercised ? "text-primary" : ""}>运动 {f.exercised ? "✓" : "—"}</span>
                  <span className={f.medicationDone ? "text-primary" : ""}>
                    用药 {f.medicationTotal === 0 ? "无" : f.medicationDone ? "✓" : "未完成"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] text-muted/70">家庭状态只显示完成情况，不显示他人的体重与指标。</p>
      </section>

      {weightOpen && (
        <WeightModal
          userId={userId}
          onClose={() => setWeightOpen(false)}
          onSaved={() => { void qc.invalidateQueries(); }}
        />
      )}
    </div>
  );
}

function TaskRow({ icon, title, detail, done, onClick }: {
  icon: ReactNode;
  title: string;
  detail: string;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-line/60 bg-[#FBF9F5] px-4 py-3.5 text-left transition-colors hover:border-primary/20 hover:bg-primary-soft/20"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${done ? "bg-primary text-white" : "bg-paper text-muted ring-1 ring-line"}`}>
        {done ? <Check size={18} /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="mt-1 block truncate text-[12px] text-muted">{detail}</span>
      </span>
      <span className={`text-[10.5px] font-semibold ${done ? "text-primary" : "text-accent"}`}>
        {done ? "完成" : "待完成"}
      </span>
    </button>
  );
}

function Sparkline({ points }: { points: WeightPoint[] }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) {
    return <div className="mt-4 flex h-[70px] items-center justify-center rounded-xl bg-white/50 text-[10px] text-muted">记录两天后显示趋势</div>;
  }
  const width = 420;
  const height = 70;
  const values = points.map((p) => p.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = 8 + ((max - p.weight) / span) * (height - 20);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = coords[coords.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-[70px] w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2F7D5F" stopOpacity=".16" />
          <stop offset="1" stopColor="#2F7D5F" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={line} fill="none" stroke="#2F7D5F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#D97757" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}
