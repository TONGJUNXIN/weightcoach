import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Pencil, Pill, Plus, Power, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Progress, Select, showError, useToast,
} from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { diseaseRepo, medicationLogRepo, medicationRepo } from "@/db/repositories";
import type { MedDueItem, MedInput, MedStatus } from "@/db/types";
import { todayStr } from "@/db/client";
import { adherenceRate } from "@/domain/adherence";

const STATUS_LABEL: Record<MedStatus, string> = { taken: "已服", skipped: "跳过", missed: "未服" };

/** 用药与打卡页（S06 / SRS 6.5）。 */
export function MedicationsPage() {
  const { user } = useUser();
  const userId = user?.id ?? "";
  const qc = useQueryClient();
  const { show } = useToast();
  const today = todayStr();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [doseUnit, setDoseUnit] = useState("mg");
  const [startOn, setStartOn] = useState("");
  const [endOn, setEndOn] = useState("");
  const [diseaseId, setDiseaseId] = useState("");
  const [times, setTimes] = useState<string[]>(["08:00"]);

  const { data: meds = [] } = useQuery({
    queryKey: ["medications", userId, showInactive],
    enabled: !!userId,
    queryFn: () => medicationRepo.list(userId, showInactive),
  });
  const { data: diseases = [] } = useQuery({
    queryKey: ["diseases", userId],
    enabled: !!userId,
    queryFn: () => diseaseRepo.list(userId),
  });
  const { data: due = [] } = useQuery({
    queryKey: ["med-due", userId, today],
    enabled: !!userId,
    queryFn: () => medicationLogRepo.dueToday(userId, today),
  });
  const [adherenceRange, setAdherenceRange] = useState<"week" | "month">("week");
  const { data: adherence } = useQuery({
    queryKey: ["adherence", userId, adherenceRange],
    enabled: !!userId,
    queryFn: async () => {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - (adherenceRange === "week" ? 6 : 29));
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return medicationLogRepo.adherence(userId, fmt(from), fmt(to));
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["medications"] });
    void qc.invalidateQueries({ queryKey: ["med-due"] });
    void qc.invalidateQueries({ queryKey: ["adherence"] });
    void qc.invalidateQueries({ queryKey: ["family-status"] });
    void qc.invalidateQueries({ queryKey: ["today-todo"] });
  };

  const openNew = () => {
    setEditing(null);
    setName(""); setDose(""); setDoseUnit("mg"); setStartOn(""); setEndOn(""); setDiseaseId(""); setTimes(["08:00"]);
    setFormOpen(true);
  };
  const openEdit = async (medId: string) => {
    const med = meds.find((m) => m.id === medId);
    if (!med) return;
    const slots = await medicationRepo.slots(userId, medId);
    setEditing(medId);
    setName(med.name); setDose(String(med.dose)); setDoseUnit(med.dose_unit);
    setStartOn(med.start_on ?? ""); setEndOn(med.end_on ?? ""); setDiseaseId(med.disease_id ?? "");
    setTimes(slots.map((s) => s.time_of_day));
    setFormOpen(true);
  };
  const submit = async () => {
    try {
      const input: MedInput = {
        name, dose: Number(dose), doseUnit: doseUnit.trim() || "mg",
        startOn: startOn || null, endOn: endOn || null, diseaseId: diseaseId || null, times,
      };
      if (editing) await medicationRepo.update(userId, editing, input);
      else await medicationRepo.create(userId, input);
      setFormOpen(false);
      refresh();
      show(editing ? "用药已更新" : "用药已添加");
    } catch (e) { showError(e, show); }
  };
  const checkIn = async (slotId: string, status: MedStatus) => {
    try { await medicationLogRepo.checkIn(userId, slotId, today, status); refresh(); }
    catch (e) { showError(e, show); }
  };
  const deactivate = async (medId: string) => {
    const med = meds.find((m) => m.id === medId);
    if (!med || !window.confirm(`确认停用「${med.name}」？历史打卡会保留。`)) return;
    try { await medicationRepo.deactivate(userId, medId, today); refresh(); show("已停用"); }
    catch (e) { showError(e, show); }
  };
  const removeMed = async (medId: string) => {
    const med = meds.find((m) => m.id === medId);
    if (!med || !window.confirm(`确认删除「${med.name}」？此操作不可恢复。`)) return;
    try {
      const logs = await medicationRepo.countLogs(userId, medId);
      if (logs > 0) throw new Error("该药已有打卡记录，不能删除；请改用「停用」以保留历史。");
      await medicationRepo.remove(userId, medId);
      refresh();
      show("已删除");
    } catch (e) { showError(e, show); }
  };

  const a = adherenceRate(adherence?.taken ?? 0, adherence?.scheduled ?? 0);
  const takenCount = due.filter((d) => d.status === "taken").length;
  const nextDose = due
    .filter((d) => d.status !== "taken" && d.status !== "skipped")
    .sort((x, y) => x.time_of_day.localeCompare(y.time_of_day))[0];
  const activeCount = meds.filter((m) => m.active === 1).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="MEDICATIONS"
        title="用药"
        subtitle="按时段打卡；药名与指标只做记录，不解释正常与否。"
        actions={<Button onClick={openNew}><Plus size={15} /> 新增用药</Button>}
      />

      <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
        <MedStat label="今日打卡" value={`${takenCount}/${due.length}`} hint={due.length ? "按时段计" : "今天没有用药"} />
        <MedStat label="启用用药" value={`${activeCount}`} unit="种" hint="不含已停用" />
        <MedStat label="依从率" value={a.scheduled ? `${a.rate}` : "—"} unit={a.scheduled ? "%" : ""} hint={a.scheduled ? `${a.taken}/${a.scheduled} 时段` : "样本不足"} />
        <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
          <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-[1.8px] text-muted">
            <span>下一顿药</span><Clock3 size={13} />
          </div>
          <div className="mt-2 text-[18px] font-semibold text-ink">{nextDose ? nextDose.time_of_day : "—"}</div>
          <div className="mt-1 truncate text-[10px] text-muted">{nextDose ? `${nextDose.name} · ${nextDose.dose} ${nextDose.dose_unit}` : "今天已安排完"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-[1.35fr_1fr]">
        <Card title={`今日打卡（${takenCount}/${due.length}）`} eyebrow="TODAY" action={<Badge tone={due.length && takenCount === due.length ? "teal" : "gold"}>{due.length && takenCount === due.length ? "已完成" : "待打卡"}</Badge>}>
          {due.length === 0 ? <Empty text="今天没有需要打卡的用药。" /> : (
            <div className="space-y-2">
              {due.map((d) => <DueRow key={d.slot_id} item={d} onCheck={(s) => void checkIn(d.slot_id, s)} />)}
            </div>
          )}
        </Card>

        <Card
          title="用药依从率"
          eyebrow="ADHERENCE"
          action={
            <Select value={adherenceRange} onChange={(e) => setAdherenceRange(e.target.value as "week" | "month")} className="h-8 w-auto py-1 text-[10px]">
              <option value="week">近 7 天</option>
              <option value="month">近 30 天</option>
            </Select>
          }
        >
          <div className="flex items-end gap-2">
            <span className="tabular text-[38px] font-semibold leading-none text-primary">{a.rate}</span>
            <span className="mb-1 text-[11px] text-muted">%</span>
          </div>
          <Progress value={a.rate} className="mt-3" />
          <p className="mt-2 text-[10px] text-muted">已打卡 {a.taken} / 应服 {a.scheduled} 个时段</p>
          {a.scheduled === 0 && <p className="mt-1 text-[10px] text-muted/70">样本不足，暂不计算依从率。</p>}
        </Card>
      </div>

      <Card
        title="用药列表"
        eyebrow="MEDICATIONS"
        action={<label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-3 w-3 accent-[#2F7D5F]" /> 显示已停用</label>}
      >
        {meds.length === 0 ? <Empty text="还没有添加用药。" /> : (
          <div className="divide-y divide-line/60">
            {meds.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${m.active === 1 ? "bg-primary-soft text-primary" : "bg-bg text-muted"}`}>
                  <Pill size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-medium text-ink">{m.name}</span>
                    <span className="text-[10px] text-muted">{m.dose} {m.dose_unit}</span>
                    <Badge tone={m.active === 1 ? "teal" : "muted"}>{m.active === 1 ? "启用中" : "已停用"}</Badge>
                  </div>
                  <div className="mt-1 text-[10px] text-muted">
                    {m.disease_id ? `${diseases.find((x) => x.id === m.disease_id)?.name ?? "—"} · ` : ""}
                    {m.start_on ?? "长期"} 起{m.end_on ? ` · ${m.end_on} 止` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button variant="ghost" size="sm" ariaLabel="编辑" onClick={() => void openEdit(m.id)}><Pencil size={13} /></Button>
                  {m.active === 1
                    ? <Button variant="ghost" size="sm" ariaLabel="停用" onClick={() => void deactivate(m.id)}><Power size={13} /></Button>
                    : <Button variant="ghost" size="sm" ariaLabel="删除" onClick={() => void removeMed(m.id)}><Trash2 size={13} className="text-danger" /></Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {formOpen && (
        <Modal
          title={editing ? "编辑用药" : "新增用药"}
          onClose={() => setFormOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setFormOpen(false)}>取消</Button><Button onClick={() => void submit()}>保存</Button></>}
        >
          <Field label="药名" hint="≤20 字"><Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="剂量"><Input type="number" min={0} step="0.1" value={dose} onChange={(e) => setDose(e.target.value)} /></Field>
            <Field label="单位"><Input value={doseUnit} onChange={(e) => setDoseUnit(e.target.value)} /></Field>
          </div>
          <Field label="关联疾病（可选）">
            <Select value={diseaseId} onChange={(e) => setDiseaseId(e.target.value)}>
              <option value="">不关联</option>
              {diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="开始日期（可选）"><Input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} /></Field>
            <Field label="结束日期（可选）"><Input type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} /></Field>
          </div>
          <Field label="每日时段（至少 1 个）" hint="HH:MM，例如 08:00 / 21:00">
            <div className="space-y-2">
              {times.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <Input type="time" value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))} />
                  <Button variant="ghost" onClick={() => setTimes(times.filter((_, j) => j !== i))}>移除</Button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setTimes([...times, "21:00"])}>+ 添加时段</Button>
            </div>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function MedStat({ label, value, unit = "", hint }: { label: string; value: string; unit?: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
      <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-[24px] font-semibold leading-none text-ink">{value}</span>
        {unit && <span className="text-[10px] text-muted">{unit}</span>}
      </div>
      <div className="mt-1.5 truncate text-[10px] text-muted/80">{hint}</div>
    </div>
  );
}

function DueRow({ item, onCheck }: { item: MedDueItem; onCheck: (s: MedStatus) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line/60 bg-[#FBF9F5] px-3 py-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.status === "taken" ? "bg-primary text-white" : "bg-paper text-muted ring-1 ring-line"}`}>
        {item.status === "taken" ? <Check size={14} /> : <Pill size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink">{item.time_of_day} · {item.name}</div>
        <div className="mt-0.5 text-[10px] text-muted">{item.dose} {item.dose_unit}{item.label ? ` · ${item.label}` : ""}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        {(["taken", "skipped", "missed"] as MedStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => onCheck(s)}
            className={`rounded-lg px-2 py-1 text-[9px] font-medium transition-colors ${
              item.status === s
                ? s === "taken" ? "bg-primary text-white" : s === "skipped" ? "bg-gold/15 text-[#8A6712]" : "bg-accent-soft text-accent"
                : "border border-line bg-paper text-muted hover:border-primary/20"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
    </div>
  );
}
