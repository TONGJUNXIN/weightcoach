import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, showError, useToast } from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { diseaseRepo, indicatorRepo } from "@/db/repositories";
import { todayStr } from "@/db/client";
import { DISEASE_PRESETS, findPreset, type IndicatorTemplate } from "@/domain/diseaseTemplates";
import { validateDiseaseName, validateIndicator } from "@/domain/validation";

interface IndicatorFormState {
  id?: string;
  diseaseId: string | null;
  name: string;
  value: string;
  unit: string;
  measuredOn: string;
  note: string;
}

const emptyIndicator = (diseaseId: string | null, tpl?: IndicatorTemplate): IndicatorFormState => ({
  diseaseId,
  name: tpl?.name ?? "",
  value: "",
  unit: tpl?.unit ?? "",
  measuredOn: todayStr(),
  note: "",
});

export function DiseasesPage() {
  const { user } = useUser();
  const { show } = useToast();
  const userId = user?.id ?? "";
  const [selected, setSelected] = useState<string | null>(null);
  const [diseaseOpen, setDiseaseOpen] = useState(false);
  const [indicatorForm, setIndicatorForm] = useState<IndicatorFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState("other");
  const [diseaseName, setDiseaseName] = useState("");
  const [diagnosedOn, setDiagnosedOn] = useState("");
  const [note, setNote] = useState("");

  const { data: diseases = [], refetch: refetchDiseases } = useQuery({
    queryKey: ["diseases", userId], enabled: !!userId, queryFn: () => diseaseRepo.list(userId),
  });
  const { data: indicators = [], refetch: refetchIndicators } = useQuery({
    queryKey: ["indicators", userId], enabled: !!userId, queryFn: () => indicatorRepo.list(userId),
  });

  useEffect(() => {
    if (!selected && diseases[0]) setSelected(diseases[0].id);
    if (selected && !diseases.some((d) => d.id === selected)) setSelected(diseases[0]?.id ?? null);
  }, [diseases, selected]);

  const activeDisease = diseases.find((d) => d.id === selected) ?? null;
  const preset = activeDisease?.preset_key ? findPreset(activeDisease.preset_key) : undefined;
  const rows = indicators.filter((i) => i.disease_id === selected);
  const pending = (preset?.indicators ?? []).filter((tpl) => !rows.some((r) => r.name === tpl.name));

  const saveDisease = async () => {
    if (!user) return;
    const chosen = findPreset(presetKey);
    const name = presetKey === "custom" ? diseaseName : chosen?.label ?? diseaseName;
    const check = validateDiseaseName(name);
    if (!check.ok) { setError(check.reason); return; }
    try {
      const id = await diseaseRepo.create(user.id, {
        name,
        presetKey: presetKey === "custom" || presetKey === "other" ? null : presetKey,
        diagnosedOn: diagnosedOn || null,
        note: note || null,
      });
      setSelected(id);
      setDiseaseOpen(false);
      setDiseaseName(""); setDiagnosedOn(""); setNote(""); setPresetKey("other");
      await refetchDiseases();
    } catch (e) { showError(e, show); }
  };

  const saveIndicator = async () => {
    if (!user || !indicatorForm) return;
    const value = Number(indicatorForm.value);
    const check = validateIndicator({ value, unit: indicatorForm.unit, measuredOn: indicatorForm.measuredOn });
    if (!check.ok) { setError(check.reason); return; }
    if (!indicatorForm.name.trim()) { setError("指标名称必填"); return; }
    try {
      const data = {
        name: indicatorForm.name.trim(), value, unit: indicatorForm.unit.trim(),
        measuredOn: indicatorForm.measuredOn, note: indicatorForm.note || null,
      };
      if (indicatorForm.id) {
        await indicatorRepo.update(user.id, indicatorForm.id, data);
      } else {
        await indicatorRepo.create(user.id, { diseaseId: indicatorForm.diseaseId, ...data });
      }
      setIndicatorForm(null);
      await refetchIndicators();
      show("指标已保存");
    } catch (e) { showError(e, show); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="HEALTH"
        title="疾病与指标"
        subtitle="只做登记和记录，不提供诊断或用药建议。"
        actions={<Button onClick={() => { setError(null); setDiseaseOpen(true); }}><Plus size={15} /> 新增疾病</Button>}
      />

      <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
        <MiniStat label="登记疾病" value={`${diseases.length}`} unit="项" />
        <MiniStat label="已记录指标" value={`${indicators.length}`} unit="项" />
        <MiniStat label="待填模板" value={`${pending.length}`} unit="项" hint={activeDisease ? activeDisease.name : "选择疾病后显示"} />
        <MiniStat label="当前查看" value={activeDisease ? activeDisease.name.slice(0, 4) : "—"} unit="" hint={activeDisease?.preset_key ? "预置疾病" : "自定义"} />
      </div>

      <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-[280px_1fr]">
        <Card title="疾病列表" eyebrow="CONDITIONS" action={<Badge tone="muted">{diseases.length}</Badge>}>
          {diseases.length === 0 ? <Empty text="还没有登记疾病" /> : (
            <div className="space-y-1.5">
              {diseases.map((d) => {
                const active = selected === d.id;
                const count = indicators.filter((i) => i.disease_id === d.id).length;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelected(d.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active ? "bg-primary-soft/70 text-primary-deep" : "hover:bg-bg"
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary text-white" : "bg-bg text-muted"}`}>
                      <FlaskConical size={13} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">{d.name}</span>
                      <span className="block text-[9px] text-muted">{d.preset_key ? "预置" : "自定义"} · {count} 项指标</span>
                    </span>
                    <ChevronRight size={13} className={active ? "text-primary" : "text-muted/50"} />
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title={activeDisease ? activeDisease.name : "指标"}
          eyebrow="INDICATORS"
          action={activeDisease ? (
            <Button variant="secondary" size="sm" onClick={() => { setError(null); setIndicatorForm(emptyIndicator(selected)); }}><Plus size={12} /> 添加指标</Button>
          ) : undefined}
        >
          {!activeDisease ? <Empty text="选择左侧疾病，或新增一个疾病" /> : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg/60 px-3 py-2 text-[10px] text-muted">
                <Badge tone={activeDisease.status === "active" ? "teal" : "muted"}>{activeDisease.status === "active" ? "记录中" : "已缓解"}</Badge>
                {activeDisease.diagnosed_on && <span>诊断 {activeDisease.diagnosed_on}</span>}
                <span>已记录 {rows.length} 项</span>
                {pending.length > 0 && <span>· 模板待填 {pending.length} 项</span>}
                {activeDisease.note && <span className="truncate">· {activeDisease.note}</span>}
              </div>

              {rows.length === 0 && pending.length === 0 && <Empty text="暂无指标" />}

              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row.id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-[#FBF9F5] px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-ink">{row.name}</div>
                      <div className="mt-0.5 text-[9px] text-muted">{row.measured_on}{row.note ? ` · ${row.note}` : ""}</div>
                    </div>
                    <div className="text-right">
                      <span className="tabular text-[18px] font-semibold text-ink">{row.value}</span>
                      <span className="ml-1 text-[9px] text-muted">{row.unit}</span>
                    </div>
                    <button aria-label="编辑指标" className="rounded-lg p-1 text-muted hover:bg-primary-soft hover:text-primary" onClick={() => setIndicatorForm({
                      id: row.id, diseaseId: row.disease_id, name: row.name, value: String(row.value),
                      unit: row.unit, measuredOn: row.measured_on, note: row.note ?? "",
                    })}><Pencil size={12} /></button>
                    <button aria-label="删除指标" className="rounded-lg p-1 text-muted hover:bg-accent-soft hover:text-danger" onClick={async () => {
                      if (!user) return;
                      try { await indicatorRepo.remove(user.id, row.id); await refetchIndicators(); } catch (e) { showError(e, show); }
                    }}><Trash2 size={12} /></button>
                  </div>
                ))}

                {pending.map((tpl) => (
                  <button
                    key={tpl.name}
                    className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:bg-primary-soft/20"
                    onClick={() => { setError(null); setIndicatorForm(emptyIndicator(selected, tpl)); }}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg text-muted"><Plus size={12} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium text-ink">{tpl.name}</span>
                      <span className="block text-[9px] text-muted">{tpl.unit} · 模板待填写</span>
                    </span>
                    <span className="text-[9px] text-muted">填写 →</span>
                  </button>
                ))}
              </div>

              <div className="flex justify-end border-t border-line/60 pt-2">
                <Button variant="ghost" size="sm" className="text-danger" onClick={async () => {
                  if (!user || !activeDisease) return;
                  if (!window.confirm(`删除「${activeDisease.name}」？不会删除关联用药。`)) return;
                  try {
                    await diseaseRepo.remove(user.id, activeDisease.id);
                    setSelected(null);
                    await refetchDiseases();
                    await refetchIndicators();
                  } catch (e) { showError(e, show); }
                }}><Trash2 size={12} /> 删除该疾病（不删除用药）</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {diseaseOpen && (
        <Modal
          title="新增疾病"
          onClose={() => setDiseaseOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setDiseaseOpen(false)}>取消</Button><Button onClick={() => void saveDisease()}>保存</Button></>}
        >
          {error && <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-[11px] text-accent">{error}</p>}
          <Field label="选择预置疾病" hint="选「其他 / 自定义」可输入名称">
            <Select value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {DISEASE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              <option value="custom">自定义…</option>
            </Select>
          </Field>
          {(presetKey === "custom" || presetKey === "other") && (
            <Field label="疾病名称（≤20 字）">
              <Input value={diseaseName} maxLength={20} onChange={(e) => setDiseaseName(e.target.value)} />
            </Field>
          )}
          <Field label="诊断日期（选填）">
            <Input type="date" value={diagnosedOn} onChange={(e) => setDiagnosedOn(e.target.value)} />
          </Field>
          <Field label="备注（选填）">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {presetKey !== "custom" && findPreset(presetKey)?.indicators.length ? (
            <p className="rounded-xl bg-bg px-3 py-2 text-[10px] text-muted">
              将自动带入指标模板：{findPreset(presetKey)?.indicators.map((i) => i.name).join(" / ")}
            </p>
          ) : null}
        </Modal>
      )}

      {indicatorForm && (
        <Modal
          title={indicatorForm.id ? "编辑指标" : "添加指标"}
          onClose={() => setIndicatorForm(null)}
          footer={<><Button variant="secondary" onClick={() => setIndicatorForm(null)}>取消</Button><Button onClick={() => void saveIndicator()}>保存</Button></>}
        >
          {error && <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-[11px] text-accent">{error}</p>}
          <Field label="指标名称">
            <Input value={indicatorForm.name} onChange={(e) => setIndicatorForm({ ...indicatorForm, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="数值">
              <Input type="number" step="any" value={indicatorForm.value} onChange={(e) => setIndicatorForm({ ...indicatorForm, value: e.target.value })} />
            </Field>
            <Field label="单位（≤8 字）">
              <Input value={indicatorForm.unit} onChange={(e) => setIndicatorForm({ ...indicatorForm, unit: e.target.value })} />
            </Field>
          </div>
          <Field label="测量日期">
            <Input type="date" value={indicatorForm.measuredOn} max={todayStr()} onChange={(e) => setIndicatorForm({ ...indicatorForm, measuredOn: e.target.value })} />
          </Field>
          <Field label="备注（选填）">
            <Input value={indicatorForm.note} onChange={(e) => setIndicatorForm({ ...indicatorForm, note: e.target.value })} />
          </Field>
          <p className="text-[10px] text-muted">指标只做记录，不解释正常与否。</p>
        </Modal>
      )}
    </div>
  );
}

function MiniStat({ label, value, unit, hint }: { label: string; value: string; unit: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-paper p-3.5 shadow-soft">
      <div className="text-[9px] font-medium uppercase tracking-[1.6px] text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tabular text-[20px] font-semibold text-ink">{value}</span>
        {unit && <span className="text-[9px] text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 truncate text-[9px] text-muted/70">{hint}</div>}
    </div>
  );
}
