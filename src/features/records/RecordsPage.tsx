import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, CheckCircle2, FileText, Pencil, Plus, Scale, Trash2, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Button, Card, Empty, Field, Input, Modal, PageHeader, Textarea, showError, useToast,
} from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { exerciseRepo, measurementRepo } from "@/db/repositories";
import { todayStr } from "@/db/client";
import { addDays, fmtDate } from "@/lib/date";
import { isBackfillDateValid } from "@/domain/adherence";
import { WeightModal } from "./WeightModal";
import { PdfImportCard } from "./PdfImportCard";

type Tab = "weight" | "exercise" | "pdf";
type TabItem = { id: Tab; label: string; icon: LucideIcon };

const tabs: TabItem[] = [
  { id: "weight", label: "体重与腰围", icon: Scale },
  { id: "exercise", label: "运动打卡", icon: Activity },
  { id: "pdf", label: "导入报告", icon: FileText },
];

/** 记录页：体重/腰围编辑删除补记 + 运动打卡（FR-REC-03/04/05/06）。 */
export function RecordsPage() {
  const { user } = useUser();
  const userId = user?.id ?? "";
  const qc = useQueryClient();
  const { show } = useToast();
  const [tab, setTab] = useState<Tab>("weight");
  const [weightOpen, setWeightOpen] = useState(false);
  const [editWeight, setEditWeight] = useState<{ id: string; date: string; weight: string; waist: string; note: string } | null>(null);
  const [exerciseNote, setExerciseNote] = useState("");
  const today = todayStr();

  const { data: weights = [] } = useQuery({
    queryKey: ["records", "weights", userId],
    enabled: !!userId,
    queryFn: () => measurementRepo.list(userId),
  });
  const { data: exercises = [] } = useQuery({
    queryKey: ["records", "exercise", userId],
    enabled: !!userId,
    queryFn: () => exerciseRepo.list(userId),
  });
  const { data: todayExercise } = useQuery({
    queryKey: ["exercise", "today", userId, today],
    enabled: !!userId,
    queryFn: () => exerciseRepo.get(userId, today),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["records"] });
    void qc.invalidateQueries({ queryKey: ["exercise"] });
    void qc.invalidateQueries({ queryKey: ["measurement"] });
    void qc.invalidateQueries({ queryKey: ["family-status"] });
    void qc.invalidateQueries({ queryKey: ["today-todo"] });
    void qc.invalidateQueries({ queryKey: ["trend"] });
  };

  const saveEdit = async () => {
    if (!editWeight) return;
    try {
      if (!isBackfillDateValid(editWeight.date, today)) throw new Error("只能补记今天或过去 30 天内的日期");
      await measurementRepo.update(
        userId,
        editWeight.id,
        editWeight.date,
        Number(editWeight.weight),
        editWeight.waist.trim() === "" ? null : Number(editWeight.waist),
        editWeight.note.trim() || null,
      );
      setEditWeight(null);
      refresh();
    } catch (e) { showError(e, show); }
  };

  const removeWeight = async (id: string) => {
    if (!window.confirm("确认删除这条体重记录？删除后图表同步更新，且不可恢复。")) return;
    try { await measurementRepo.remove(userId, id); refresh(); }
    catch (e) { showError(e, show); }
  };

  const saveExercise = async (did: boolean) => {
    try {
      await exerciseRepo.save(userId, today, did, exerciseNote.trim() || null);
      refresh();
      show(did ? "已记录：今天运动了" : "已记录：今天没运动");
    } catch (e) { showError(e, show); }
  };

  const latest = weights[0];
  const latestWaist = weights.find((w) => w.waist_cm != null)?.waist_cm ?? null;
  const monthPrefix = today.slice(0, 7);
  const monthCount = weights.filter((w) => w.measured_on.startsWith(monthPrefix)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RECORDS"
        title="记录"
        subtitle="只记录，不评判。所有数据仅保存在本机。"
        actions={<Button onClick={() => setWeightOpen(true)}><Plus size={15} /> 记体重</Button>}
      />

      <div className="grid grid-cols-1 gap-3 min-[1000px]:grid-cols-3">
        <StatCard label="最新体重" value={latest ? `${latest.weight_kg.toFixed(1)}` : "—"} unit="kg" hint={latest?.measured_on ?? "还没有记录"} />
        <StatCard label="最近腰围" value={latestWaist != null ? `${latestWaist.toFixed(1)}` : "—"} unit="cm" hint={latestWaist != null ? "按最近一次有腰围的记录" : "还没有腰围"} />
        <StatCard label="本月记录" value={`${monthCount}`} unit="次" hint="每次记录都算数" />
      </div>

      <div className="flex w-fit gap-1 rounded-2xl border border-line/80 bg-paper p-1 shadow-soft">
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12px] transition-colors ${
                active ? "bg-primary font-semibold text-white shadow-soft" : "text-muted hover:bg-bg hover:text-ink"
              }`}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "pdf" ? (
        <PdfImportCard userId={userId} />
      ) : tab === "weight" ? (
        <Card
          title="体重与腰围记录"
          eyebrow="WEIGHT & WAIST"
          action={<Button variant="secondary" size="sm" onClick={() => setWeightOpen(true)}><Plus size={13} /> 补记</Button>}
        >
          {weights.length === 0 ? <Empty text="还没有记录，先称一次吧。" /> : (
            <div className="divide-y divide-line/60">
              {weights.map((r, i) => {
                const older = weights[i + 1];
                const diff = older ? Math.round((r.weight_kg - older.weight_kg) * 10) / 10 : null;
                return (
                  <div key={r.id} className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-[74px] shrink-0">
                      <div className="text-[11px] font-medium text-ink">{r.measured_on.slice(5)}</div>
                      <div className="mt-0.5 text-[9px] text-muted">{weekday(r.measured_on)}</div>
                    </div>
                    <div className="w-[104px] shrink-0">
                      <span className="tabular text-[19px] font-semibold text-ink">{r.weight_kg.toFixed(1)}</span>
                      <span className="ml-1 text-[10px] text-muted">kg</span>
                      {diff != null && diff !== 0 && (
                        <span className={`ml-2 text-[9px] font-semibold ${diff < 0 ? "text-primary" : "text-accent"}`}>
                          {diff < 0 ? "↓" : "↑"} {Math.abs(diff).toFixed(1)}
                        </span>
                      )}
                    </div>
                    <div className="w-[92px] shrink-0 text-[11px] text-muted">
                      {r.waist_cm != null ? `腰围 ${r.waist_cm.toFixed(1)}` : "腰围 —"}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-[11px] text-muted">{r.note ?? ""}</div>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        size="sm"
                        variant="ghost"
                        ariaLabel="编辑"
                        onClick={() => setEditWeight({ id: r.id, date: r.measured_on, weight: String(r.weight_kg), waist: r.waist_cm == null ? "" : String(r.waist_cm), note: r.note ?? "" })}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" ariaLabel="删除" onClick={() => void removeWeight(r.id)}>
                        <Trash2 size={13} className="text-danger" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-[1.15fr_1fr] gap-4">
          <Card title="今天运动了吗？" eyebrow="DAILY CHECK-IN">
            <p className="mb-4 text-[11px] leading-relaxed text-muted">
              只记录「今天运动了 / 没运动」+ 备注；不记类型、时长与消耗。接入运动 App 后再补明细。
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <ExerciseChoice
                active={todayExercise?.did_exercise === 1}
                icon={<CheckCircle2 size={18} />}
                title="今天运动了"
                hint="散步、力量、通勤都算"
                onClick={() => void saveExercise(true)}
              />
              <ExerciseChoice
                active={todayExercise?.did_exercise === 0}
                icon={<XCircle size={18} />}
                title="今天没运动"
                hint="休息也是计划的一部分"
                onClick={() => void saveExercise(false)}
              />
            </div>
            <div className="mt-4">
              <Field label="备注（可选）" hint="例如：晚饭后走了 20 分钟">
                <Textarea rows={2} value={exerciseNote} onChange={(e) => setExerciseNote(e.target.value)} placeholder="今天的感觉、做了什么…" />
              </Field>
            </div>
            {todayExercise && (
              <div className="mt-3 rounded-xl bg-primary-soft/60 px-3 py-2 text-[11px] text-primary-deep">
                今日已记录：{todayExercise.did_exercise === 1 ? "运动了" : "没运动"}
                {todayExercise.note ? ` · ${todayExercise.note}` : ""}
              </div>
            )}
          </Card>

          <Card title="历史打卡" eyebrow="HISTORY" action={<BadgeCount value={exercises.length} />}>
            {exercises.length === 0 ? <Empty text="还没有运动打卡。" /> : (
              <div className="max-h-[360px] space-y-1 overflow-auto pr-1">
                {exercises.slice(0, 40).map((e) => (
                  <div key={e.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-bg">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${e.did_exercise === 1 ? "bg-primary" : "bg-line"}`} />
                    <span className="w-[64px] shrink-0 text-[10px] text-muted">{e.logged_on.slice(5)}</span>
                    <span className={`text-[11px] font-medium ${e.did_exercise === 1 ? "text-primary" : "text-muted"}`}>
                      {e.did_exercise === 1 ? "运动了" : "没运动"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-muted">{e.note ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {weightOpen && <WeightModal userId={userId} onClose={() => setWeightOpen(false)} onSaved={refresh} />}
      {editWeight && (
        <Modal
          title="编辑记录"
          onClose={() => setEditWeight(null)}
          footer={<><Button variant="secondary" onClick={() => setEditWeight(null)}>取消</Button><Button onClick={() => void saveEdit()}>保存</Button></>}
        >
          <Field label="日期"><Input type="date" value={editWeight.date} max={today} min={fmtDate(addDays(new Date(), -30))} onChange={(e) => setEditWeight({ ...editWeight, date: e.target.value })} /></Field>
          <Field label="体重（kg）"><Input type="number" step="0.1" value={editWeight.weight} onChange={(e) => setEditWeight({ ...editWeight, weight: e.target.value })} /></Field>
          <Field label="腰围（cm，可选）"><Input type="number" step="0.5" value={editWeight.waist} onChange={(e) => setEditWeight({ ...editWeight, waist: e.target.value })} /></Field>
          <Field label="备注"><Textarea rows={2} value={editWeight.note} onChange={(e) => setEditWeight({ ...editWeight, note: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function StatCard({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
      <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-[24px] font-semibold leading-none text-ink">{value}</span>
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
      <div className="mt-1.5 truncate text-[10px] text-muted/80">{hint}</div>
    </div>
  );
}

function ExerciseChoice({ active, icon, title, hint, onClick }: {
  active: boolean;
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border p-3.5 text-left transition-colors ${
        active ? "border-primary bg-primary-soft/70" : "border-line/80 bg-[#FBF9F5] hover:border-primary/25"
      }`}
    >
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${active ? "bg-primary text-white" : "bg-paper text-muted ring-1 ring-line"}`}>
        {icon}
      </span>
      <span className="mt-2 block text-[12px] font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-[9px] leading-relaxed text-muted">{hint}</span>
    </button>
  );
}

function BadgeCount({ value }: { value: number }) {
  return <span className="rounded-full bg-bg px-2 py-1 text-[9px] font-medium text-muted">{value} 天</span>;
}

function weekday(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `周${["日", "一", "二", "三", "四", "五", "六"][d.getDay()]}`;
}
