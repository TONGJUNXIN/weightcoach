import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, Cloud, CloudLightning, CloudRain, CloudSun, MapPin, Pencil, RefreshCw,
  Snowflake, Sparkles, Sun, Wind, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Badge, Button, Card, Field, Input, Modal, PageHeader, Select, showError, useToast,
} from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { fmtDate, mondayStart, addDays } from "@/lib/date";
import { copy } from "@/lib/copy";
import { planRepo, profileRepo, type SavedPlanItem } from "@/db/repositories";
import type { PlanItemRow } from "@/db/types";
import {
  actionForMode, availableActions, generateWeekPlan, validatePlan,
  type Constraint, type PlanIntensity, type PlanPlace,
} from "@/domain/plan";
import { weatherScore, indoorFallbackDay } from "@/domain/weather";
import { planReasonPrompt } from "@/domain/ai";
import { loadWeather, searchCity, type CityHit, type WeatherSnapshot } from "@/lib/weatherService";
import { AiReasonButton } from "@/features/ai/AiReasonButton";

const intensityLabel: Record<PlanIntensity, string> = { low: "低强度", medium: "中等", high: "较高" };
const placeLabel: Record<PlanPlace, string> = { outdoor: "户外", indoor: "室内" };
const conclusionLabel = {
  outdoor: "适宜户外", outdoor_timed: "可户外·择时",
  indoor_preferred: "室内优先", indoor: "不建议户外",
} as const;

const weatherIcons: Array<{ match: string; icon: LucideIcon }> = [
  { match: "雷", icon: CloudLightning },
  { match: "雪", icon: Snowflake },
  { match: "雨", icon: CloudRain },
  { match: "晴", icon: Sun },
  { match: "云", icon: CloudSun },
  { match: "风", icon: Wind },
];

function WeatherIcon({ text }: { text?: string | null }) {
  const found = weatherIcons.find((w) => text?.includes(w.match))?.icon ?? Cloud;
  const Icon = found;
  return <Icon size={18} className="text-primary" />;
}

function rowToItem(row: PlanItemRow): SavedPlanItem {
  return {
    date: row.plan_date,
    mode: row.mode,
    minutes: row.minutes,
    intensity: row.intensity as PlanIntensity,
    place: row.place as PlanPlace,
    reason: row.reason ?? "",
    status: row.status,
  };
}

/** S10 / SRS 6.9：未来 7 天天气、适宜度与周计划（FR-PLN-01~09）。 */
export function PlanPage() {
  const { user } = useUser();
  const { show } = useToast();
  const qc = useQueryClient();
  const userId = user?.id ?? "";
  const weekStart = fmtDate(mondayStart(new Date()));

  const [weatherNonce, setWeatherNonce] = useState(0);
  const [cityOpen, setCityOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<CityHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PlanItemRow | null>(null);
  const [newMode, setNewMode] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newMinutes, setNewMinutes] = useState(30);
  const [newPlace, setNewPlace] = useState<PlanPlace>("outdoor");

  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["profile", userId], enabled: !!userId, queryFn: () => profileRepo.get(userId),
  });
  const { data: weather, isFetching: weatherLoading } = useQuery<WeatherSnapshot>({
    queryKey: ["weather", profile?.city_id, weatherNonce],
    enabled: !!profile?.city_id,
    queryFn: () => loadWeather(profile!.city_id!, profile?.city_name ?? "", weatherNonce > 0),
  });
  const { data: saved } = useQuery({
    queryKey: ["plan", userId, weekStart], enabled: !!userId,
    queryFn: () => planRepo.get(userId, weekStart),
  });

  const constraints: Constraint[] = profile
    ? (() => { try { return JSON.parse(profile.constraints_json) as Constraint[]; } catch { return []; } })()
    : [];
  const items = saved?.items ?? [];
  const validation = validatePlan(items.map(rowToItem));
  const actions = availableActions(constraints).filter((a) => a.group !== "rest");

  const refreshWeather = () => setWeatherNonce((n) => n + 1);

  const search = async () => {
    setSearching(true);
    try {
      const result = await searchCity(keyword);
      setHits(result);
      if (!result.length) show(copy.weather.searchFailed, "error");
    } catch (e) { showError(e, show); }
    finally { setSearching(false); }
  };

  const chooseCity = async (hit: CityHit) => {
    try {
      await profileRepo.setCity(userId, hit.id, `${hit.name}${hit.region ? ` · ${hit.region}` : ""}`);
      setCityOpen(false);
      setHits([]);
      await refetchProfile();
      refreshWeather();
      show(`已切换城市：${hit.name}`);
    } catch (e) { showError(e, show); }
  };

  const generate = async () => {
    if (!profile?.city_id) { show(copy.weather.cityRequired); return; }
    setBusy(true);
    try {
      // 天气不可用/仍在加载时直接按室内兜底生成，绝不阻塞保存
      const days = weather?.days?.length
        ? weather.days
        : Array.from({ length: 7 }, (_, i) => indoorFallbackDay(fmtDate(addDays(new Date(), i))));
      const snapshot = {
        days,
        source: weather?.source ?? "unavailable",
      };
      const locked = items.filter((i) => i.status === "locked").map(rowToItem);
      const result = generateWeekPlan({
        weekStart,
        days: snapshot.days.map((d) => ({ date: d.date, score: weatherScore(d) })),
        constraints,
        locked,
      });
      const lockedKeys = new Set(locked.map((l) => `${l.date}|${l.mode}`));
      const toSave: SavedPlanItem[] = result.items.map((item) => ({
        ...item,
        status: lockedKeys.has(`${item.date}|${item.mode}`) ? "locked" : "planned",
      }));
      await planRepo.save(userId, weekStart, toSave, {
        sessions: result.sessions,
        totalMinutes: result.totalMinutes,
        strength: result.strength,
        restDays: result.restDays,
        source: snapshot.source,
        generatedAt: new Date().toISOString(),
      });
      await qc.invalidateQueries({ queryKey: ["plan", userId] });
      show(result.valid ? copy.plan.statusOk : result.issues.join("；"));
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "error");
    }
    finally { setBusy(false); }
  };

  const setStatus = async (row: PlanItemRow, status: string) => {
    try {
      await planRepo.setStatus(userId, row.id, status);
      await qc.invalidateQueries({ queryKey: ["plan", userId] });
    } catch (e) { showError(e, show); }
  };

  const openEdit = (row: PlanItemRow, dates: string[]) => {
    const action = actionForMode(row.mode);
    setEditing(row);
    setNewMode(row.mode);
    setNewDate(row.plan_date || dates[0] || "");
    setNewMinutes(row.minutes || 30);
    setNewPlace((row.place as PlanPlace) || action?.places[0] || "outdoor");
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const action = actionForMode(newMode);
      await planRepo.replace(userId, editing.id, {
        date: newDate,
        mode: newMode,
        minutes: Math.max(10, Math.min(90, newMinutes || 30)),
        intensity: action?.intensity ?? (editing.intensity as PlanIntensity),
        place: newPlace,
        reason: "手动调整",
        status: "locked",
      });
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["plan", userId] });
      show("安排已更新并锁定");
    } catch (e) { showError(e, show); }
  };

  const dates = weather?.days.map((d) => d.date) ?? [];
  const activeSessions = items.filter((i) => i.mode !== "休息").length;
  const totalMinutes = items.reduce((s, i) => s + i.minutes, 0);
  const strengthCount = items.filter((i) => (i.mode || "").startsWith("力量")).length;
  const restCount = items.filter((i) => i.mode === "休息").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="WEEKLY PLAN"
        title="本周计划"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={12} /> {profile?.city_name ?? "未设置城市"} · 天气驱动 · 只排方式与时长，不计算消耗
          </span>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCityOpen(true)}>切换城市</Button>
            <Button variant="secondary" size="sm" disabled={weatherLoading} onClick={refreshWeather}>
              <RefreshCw size={13} className={weatherLoading ? "animate-spin" : ""} /> 刷新天气
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void generate()}>
              <Sparkles size={13} /> {busy ? "生成中…" : items.length ? "重新生成" : "生成本周计划"}
            </Button>
          </>
        }
      />

      {weather?.unavailable && (
        <div className="flex items-center justify-between rounded-2xl bg-accent-soft px-4 py-3 text-[11px] text-accent">
          <span>{copy.weather.unavailable}</span>
          <button className="font-semibold underline" onClick={() => void generate()}>{copy.weather.retry}</button>
        </div>
      )}
      {weather?.stale && !weather.unavailable && weather.fetchedAt && (
        <div className="rounded-2xl bg-accent-soft px-4 py-3 text-[11px] text-accent">
          {copy.weather.stale(new Date(weather.fetchedAt).toLocaleString("zh-CN"))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 min-[1200px]:grid-cols-4">
        <PlanStat label="训练次数" value={`${activeSessions}`} unit="次" hint="本周计划" />
        <PlanStat label="总时长" value={`${totalMinutes}`} unit="分钟" hint="建议 150–300" />
        <PlanStat label="力量训练" value={`${strengthCount}`} unit="次" hint="建议 2 次" />
        <PlanStat label="休息" value={`${restCount}`} unit="天" hint="至少 1 天" />
      </div>

      {items.length > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-[10px] ${
          validation.ok ? "bg-primary-soft/60 text-primary-deep" : "bg-accent-soft text-accent"
        }`}>
          <span>{validation.ok ? "计划满足总量规则" : `计划待调整：${validation.issues.join("；")}`}</span>
          <span>{items.length} 项 · 可点击每天的铅笔替换或改期</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 min-[1200px]:grid-cols-4">
        {weather?.days.map((day) => {
          const s = weatherScore(day);
          const row = items.find((i) => i.plan_date === day.date);
          const weekday = ["日", "一", "二", "三", "四", "五", "六"][new Date(`${day.date}T00:00:00`).getDay()];
          const isToday = day.date === fmtDate(new Date());
          return (
            <div
              key={day.date}
              className={`flex min-h-[196px] flex-col rounded-2xl border p-3.5 shadow-soft transition-colors ${
                isToday ? "border-primary bg-gradient-to-b from-primary-soft/70 to-paper" : "border-line/80 bg-paper"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[9px] font-medium uppercase tracking-[1.5px] text-muted">周{weekday}</div>
                  <div className={`mt-0.5 text-[16px] font-semibold ${isToday ? "text-primary" : "text-ink"}`}>{day.date.slice(5)}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <WeatherIcon text={day.text} />
                  <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${
                    s.score >= 75 ? "bg-primary-soft text-primary-deep" : s.score >= 55 ? "bg-[#FBF6E4] text-[#9A7416]" : "bg-accent-soft text-accent"
                  }`}>{s.score} 分</span>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-2 text-[9px] text-muted">
                <span>{day.tempMin.toFixed(0)}~{day.tempMax.toFixed(0)}℃</span>
                <span>降水 {day.pop ?? "—"}%</span>
                <span>AQI {day.aqi ?? "—"}</span>
              </div>
              <div className="mt-1 text-[9px] text-muted/80">{conclusionLabel[s.conclusion]}</div>

              <div className="mt-3 flex-1 rounded-xl bg-bg/70 p-2.5">
                {row ? (
                  <>
                    <div className="text-[12px] font-semibold text-ink">{row.mode}</div>
                    <div className="mt-0.5 text-[9px] text-muted">
                      {row.minutes > 0 ? `${row.minutes} 分钟 · ` : ""}{intensityLabel[row.intensity as PlanIntensity] ?? "中等"} · {placeLabel[row.place as PlanPlace] ?? "室内"}
                    </div>
                    {row.reason && <div className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-muted/80">{row.reason}</div>}
                  </>
                ) : (
                  <div className="flex h-full min-h-[52px] flex-col items-center justify-center text-[10px] text-muted">
                    未安排
                  </div>
                )}
              </div>

              {row && (
                <div className="mt-2 flex items-center justify-between">
                  <span className={`text-[9px] font-medium ${row.status === "done" ? "text-primary" : row.status === "skipped" ? "text-muted" : "text-accent"}`}>
                    {row.status === "done" ? "✓ 已完成" : row.status === "skipped" ? "已跳过" : row.status === "locked" ? "已锁定" : "待完成"}
                  </span>
                  <div className="flex gap-0.5">
                    <button
                      aria-label="切换完成"
                      className="rounded-lg p-1 text-muted hover:bg-primary-soft hover:text-primary"
                      onClick={() => void setStatus(row, row.status === "done" ? "planned" : "done")}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      aria-label="编辑"
                      className="rounded-lg p-1 text-muted hover:bg-primary-soft hover:text-primary"
                      onClick={() => openEdit(row, dates)}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      aria-label="跳过"
                      className="rounded-lg p-1 text-muted hover:bg-accent-soft hover:text-accent"
                      onClick={() => void setStatus(row, "skipped")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {items.length > 0 && (
        <Card title="计划理由" eyebrow="AI OPTIONAL" action={<Badge tone="muted">可选</Badge>}>
          <AiReasonButton
            task="planReason"
            userId={userId}
            userPrompt={planReasonPrompt(JSON.stringify({
              items: items.map((i) => ({ date: i.plan_date, mode: i.mode, minutes: i.minutes, intensity: i.intensity, place: i.place })),
              constraints,
              weather: (weather?.days ?? []).map((d) => ({ date: d.date, conclusion: weatherScore(d).conclusion })),
            }))}
            fallbackText="本周计划已按天气与登记的禁忌安排，运动以中等强度为主，避开了不适时段。"
            label="解释这份计划"
          />
        </Card>
      )}

      {cityOpen && (
        <Modal title="选择城市" onClose={() => setCityOpen(false)} footer={<Button variant="secondary" onClick={() => setCityOpen(false)}>关闭</Button>}>
          <Field label="输入城市关键词" hint="不使用定位权限；选择后保存到当前成员档案">
            <div className="flex gap-2">
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="如：北京、上海" />
              <Button disabled={searching || !keyword.trim()} onClick={() => void search()}>搜索</Button>
            </div>
          </Field>
          <div className="max-h-64 space-y-1 overflow-auto">
            {hits.map((hit) => (
              <button key={hit.id} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-bg" onClick={() => void chooseCity(hit)}>
                {hit.name} <span className="text-[10px] text-muted">{hit.region}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          title="替换动作 / 改期"
          onClose={() => setEditing(null)}
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>取消</Button><Button onClick={() => void saveEdit()}>保存并锁定</Button></>}
        >
          <Field label="动作">
            <Select
              value={newMode}
              onChange={(e) => {
                const mode = e.target.value;
                const action = actionForMode(mode);
                setNewMode(mode);
                if (action && !action.places.includes(newPlace)) setNewPlace(action.places[0] ?? "indoor");
              }}
            >
              {actions.map((a) => <option key={a.mode} value={a.mode}>{a.mode}（{intensityLabel[a.intensity]}）</option>)}
            </Select>
          </Field>
          <Field label="场地">
            <Select value={newPlace} onChange={(e) => setNewPlace(e.target.value as PlanPlace)}>
              {(actionForMode(newMode)?.places ?? ["indoor"]).map((p) => <option key={p} value={p}>{placeLabel[p]}</option>)}
            </Select>
          </Field>
          <Field label="日期">
            <Select value={newDate} onChange={(e) => setNewDate(e.target.value)}>
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          <Field label="时长（分钟）">
            <Input type="number" min={10} max={90} value={newMinutes} onChange={(e) => setNewMinutes(Number(e.target.value))} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function PlanStat({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
      <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-[24px] font-semibold leading-none text-ink">{value}</span>
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
      <div className="mt-1.5 text-[10px] text-muted/80">{hint}</div>
    </div>
  );
}
