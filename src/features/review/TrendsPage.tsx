import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Plus, Target, TrendingDown, TrendingUp } from "lucide-react";
import {
  Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, showError, useToast,
} from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { eventMarkerRepo, goalRepo, trendRepo } from "@/db/repositories";
import { addDays, fmtDate, rangeFrom } from "@/lib/date";
import { todayStr } from "@/db/client";

type Range = 7 | 30 | 90 | "all";

const RANGE_LABEL: Record<Range, string> = { 7: "7 天", 30: "30 天", 90: "90 天", all: "全部" };

/** S08 趋势页（SRS FR-REV-01/02/03）：体重图 + 腰围图 + 指标图。 */
export function TrendsPage() {
  const { user } = useUser();
  const userId = user?.id ?? "";
  const { show } = useToast();
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>(30);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventDate, setEventDate] = useState(todayStr());
  const [eventLabel, setEventLabel] = useState("");

  const from = rangeFrom(range);
  const { data: goal } = useQuery({ queryKey: ["goal", userId], enabled: !!userId, queryFn: () => goalRepo.get(userId) });
  const { data: weightPoints = [] } = useQuery({
    queryKey: ["trend", "weight", userId, range, goal?.target_weight_kg],
    enabled: !!userId,
    queryFn: () => trendRepo.weightPoints(userId, from ?? "1900-01-01", todayStr(), goal?.target_weight_kg ?? null),
  });
  const { data: waistPoints = [] } = useQuery({
    queryKey: ["trend", "waist", userId, range],
    enabled: !!userId,
    queryFn: () => trendRepo.waistPoints(userId, from ?? "1900-01-01", todayStr()),
  });
  const { data: baselinePoints = [] } = useQuery({
    queryKey: ["trend", "waist-baseline", userId],
    enabled: !!userId,
    queryFn: () => trendRepo.waistPoints(
      userId,
      fmtDate(addDays(new Date(), -35)),
      fmtDate(addDays(new Date(), -21)),
    ),
  });
  const { data: indicatorSeries = [] } = useQuery({
    queryKey: ["trend", "indicator", userId, range],
    enabled: !!userId,
    queryFn: () => trendRepo.indicatorSeries(userId, from ?? "1900-01-01", todayStr()),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["events", userId],
    enabled: !!userId,
    queryFn: () => eventMarkerRepo.list(userId),
  });

  const latest = weightPoints.length ? weightPoints[weightPoints.length - 1] : null;
  const first = weightPoints.length ? weightPoints[0] : null;
  const change = latest && first ? Math.round((latest.weight - first.weight) * 10) / 10 : null;
  const avg7 = weightPoints.length
    ? Math.round((weightPoints.slice(-7).reduce((s, p) => s + p.weight, 0) / Math.min(7, weightPoints.length)) * 10) / 10
    : null;
  const progress = latest && first && goal && first.weight > goal.target_weight_kg
    ? ((first.weight - latest.weight) / (first.weight - goal.target_weight_kg)) * 100
    : null;
  const waistFourWeeksAgo = baselinePoints.length ? baselinePoints[baselinePoints.length - 1]?.waist ?? null : null;

  const indicatorGroups = new Map<string, typeof indicatorSeries>();
  for (const row of indicatorSeries) {
    const key = `${row.disease} · ${row.name} (${row.unit})`;
    if (!indicatorGroups.has(key)) indicatorGroups.set(key, []);
    indicatorGroups.get(key)!.push(row);
  }

  const refreshTrend = () => {
    void qc.invalidateQueries({ queryKey: ["trend"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
  };

  const addEvent = async () => {
    if (!eventLabel.trim()) { show("先写一个事件名称", "error"); return; }
    try {
      await eventMarkerRepo.add(userId, eventDate, "custom", eventLabel.trim());
      setEventOpen(false);
      setEventLabel("");
      refreshTrend();
      show("事件已标记");
    } catch (e) { showError(e, show); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="TRENDS"
        title="趋势"
        subtitle="体重、腰围、指标只看变化，不给健康判断。"
        actions={
          <>
            <div className="flex gap-1 rounded-xl border border-line/80 bg-paper p-1 shadow-soft">
              {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-lg px-2.5 py-1.5 text-[10px] transition-colors ${
                    range === r ? "bg-primary font-semibold text-white" : "text-muted hover:bg-bg"
                  }`}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEventOpen(true)}>
              <Plus size={13} /> 标记事件
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 min-[1200px]:grid-cols-4">
        <Kpi label="最新体重" value={latest ? latest.weight.toFixed(1) : "—"} unit="kg" hint={latest?.date ?? "还没有记录"} />
        <Kpi
          label="区间变化"
          value={change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(1)}`}
          unit="kg"
          hint={change == null ? "至少两条记录" : change <= 0 ? "在下降" : "在上升"}
          tone={change == null ? "muted" : change <= 0 ? "good" : "warn"}
          icon={change == null ? null : change <= 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
        />
        <Kpi label="7 日均值" value={avg7 == null ? "—" : avg7.toFixed(1)} unit="kg" hint="过滤单日波动" />
        <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
          <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[1.8px] text-muted">
            <span>目标进度</span>
            <Target size={13} />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="tabular text-[24px] font-semibold leading-none text-ink">
              {progress == null ? "—" : Math.max(0, Math.min(100, Math.round(progress)))}
            </span>
            <span className="text-[10px] text-muted">{progress == null ? "" : "%"}</span>
          </div>
          <Progress value={progress ?? 0} className="mt-2" />
          <div className="mt-1.5 text-[10px] text-muted/80">目标 {goal?.target_weight_kg.toFixed(1) ?? "—"} kg</div>
        </div>
      </div>

      <Card
        title="体重趋势"
        eyebrow="WEIGHT · DAILY + 7D AVG"
        action={<Badge tone="muted">{weightPoints.length} 个记录点</Badge>}
      >
        {weightPoints.length === 0 ? <Empty text="还没有体重记录，先称一次吧。" /> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={weightPoints} margin={{ top: 8, right: 14, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#EDF1EF" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#8A9793" }} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 9, fill: "#8A9793" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: "1px solid #E7E2D9", boxShadow: "0 10px 30px rgba(32,48,46,.1)", fontSize: 11 }}
                labelStyle={{ color: "#7C8A86", fontSize: 10 }}
              />
              <Legend wrapperStyle={{ fontSize: 10, color: "#7C8A86" }} iconType="circle" iconSize={7} />
              <Line type="monotone" dataKey="weight" name="体重" stroke="#2F7D5F" dot={{ r: 2, fill: "#2F7D5F", strokeWidth: 0 }} strokeWidth={2.4} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="ma7" name="7 日均线" stroke="#D97757" dot={false} strokeWidth={2} />
              {goal && (
                <ReferenceLine
                  y={goal.target_weight_kg}
                  stroke="#B9C6C1"
                  strokeDasharray="5 5"
                  label={{ value: `目标 ${goal.target_weight_kg}`, fontSize: 9, fill: "#8A9793", position: "insideTopRight" }}
                />
              )}
              {events.filter((e) => !from || e.event_date >= from).map((e) => (
                <ReferenceLine
                  key={e.id}
                  x={e.event_date}
                  stroke="#C9A227"
                  strokeDasharray="2 4"
                  label={{ value: e.label, fontSize: 8, fill: "#9A7416", angle: -60, position: "insideTopLeft" }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="腰围趋势" eyebrow="WAIST · WEEKLY" action={<Badge tone="muted">每周一次</Badge>}>
          {waistPoints.length === 0 ? <Empty text="还没有腰围记录。" /> : (
            <>
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={waistPoints} margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#EDF1EF" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#8A9793" }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 9, fill: "#8A9793" }} axisLine={false} tickLine={false} width={38} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E7E2D9", fontSize: 11 }} />
                  <Line type="monotone" dataKey="waist" name="腰围 (cm)" stroke="#2F7D5F" dot={{ r: 3, fill: "#2F7D5F", strokeWidth: 0 }} strokeWidth={2.2} />
                  {waistFourWeeksAgo != null && (
                    <ReferenceLine y={waistFourWeeksAgo} stroke="#D97757" strokeDasharray="5 5" label={{ value: `4 周前 ${waistFourWeeksAgo}`, fontSize: 9, fill: "#A95F45" }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-2 text-[10px] text-muted">
                最近 {(waistPoints[waistPoints.length - 1]?.waist ?? 0).toFixed(1)} cm · 4 周前 {waistFourWeeksAgo?.toFixed(1) ?? "无数据"} cm
              </p>
            </>
          )}
        </Card>

        <Card title="指标趋势" eyebrow="INDICATORS · BY DISEASE" action={<Badge tone="muted">{indicatorGroups.size} 组</Badge>}>
          {indicatorGroups.size === 0 ? <Empty text="还没有指标记录。" /> : (
            <div className="max-h-[300px] space-y-4 overflow-auto pr-1">
              {[...indicatorGroups.entries()].map(([group, rows]) => (
                <div key={group}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-[10px] font-medium text-muted">{group}</div>
                    <div className="text-[9px] text-muted/70">{rows.length} 次</div>
                  </div>
                  <ResponsiveContainer width="100%" height={105}>
                    <LineChart data={rows} margin={{ top: 3, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#EDF1EF" />
                      <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#8A9793" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 8, fill: "#8A9793" }} axisLine={false} tickLine={false} width={34} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E7E2D9", fontSize: 11 }} />
                      <Line type="monotone" dataKey="value" name={group} stroke="#2F7D5F" dot={{ r: 2, fill: "#2F7D5F", strokeWidth: 0 }} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {eventOpen && (
        <Modal
          title="标记事件"
          onClose={() => setEventOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setEventOpen(false)}>取消</Button><Button onClick={() => void addEvent()}>保存</Button></>}
        >
          <Field label="日期"><Input type="date" value={eventDate} max={todayStr()} onChange={(e) => setEventDate(e.target.value)} /></Field>
          <Field label="事件名称" hint="如：出差、聚餐、开始新药；只做标记不解释">
            <Input value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} placeholder="例如：出差一周" />
          </Field>
          {events.length > 0 && (
            <div className="border-t border-line/70 pt-3">
              <div className="mb-2 text-[10px] text-muted">已有标记</div>
              <div className="max-h-[180px] space-y-1 overflow-auto">
                {events.slice(0, 10).map((e) => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg bg-bg px-2.5 py-1.5 text-[10px]">
                    <span>{e.event_date} · {e.label}</span>
                    <button
                      className="text-danger hover:underline"
                      onClick={async () => {
                        try {
                          await eventMarkerRepo.remove(userId, e.id);
                          refreshTrend();
                        } catch (err) { showError(err, show); }
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Kpi({ label, value, unit, hint, tone = "muted", icon }: {
  label: string;
  value: string;
  unit: string;
  hint: string;
  tone?: "muted" | "good" | "warn";
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
      <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[1.8px] text-muted">
        <span>{label}</span>
        <span className={tone === "good" ? "text-primary" : tone === "warn" ? "text-accent" : "text-muted"}>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-[24px] font-semibold leading-none text-ink">{value}</span>
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
      <div className="mt-1.5 truncate text-[10px] text-muted/80">{hint}</div>
    </div>
  );
}
