import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { Badge, Button, Card, Empty, PageHeader, showError, useToast } from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { copy } from "@/lib/copy";
import { fmtDate } from "@/lib/date";
import { calcEnergy } from "@/domain/energy";
import {
  calcDietTargets, DIET_DISCLAIMER, diseaseConstraints, EATING_OUT_TIPS,
  mealSplit, shoppingList, SWAP_GROUPS,
} from "@/domain/diet";
import { diseaseRepo, goalRepo, measurementRepo, profileRepo } from "@/db/repositories";
import { DietAiCard } from "./DietAiCard";

const STORAGE_KEY = "weightcoach:shopping-checked";

function loadChecked(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch { return {}; }
}

/** S11 / SRS 6.10：目标、疾病约束、餐次模板、四类替换、外食策略与购物清单。 */
export function DietPage() {
  const { user } = useUser();
  const { show } = useToast();
  const userId = user?.id ?? "";
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecked);

  const { data: profile } = useQuery({
    queryKey: ["profile", userId], enabled: !!userId, queryFn: () => profileRepo.get(userId),
  });
  const { data: goal } = useQuery({
    queryKey: ["goal", userId], enabled: !!userId, queryFn: () => goalRepo.get(userId),
  });
  const { data: latest } = useQuery({
    queryKey: ["measurement", "latest", userId], enabled: !!userId,
    queryFn: () => measurementRepo.latest(userId),
  });
  const { data: diseases = [] } = useQuery({
    queryKey: ["diseases", userId], enabled: !!userId, queryFn: () => diseaseRepo.list(userId),
  });

  const energy = profile && goal && latest
    ? calcEnergy({
      sex: profile.sex, birthYear: profile.birth_year, heightCm: profile.height_cm,
      weightKg: latest.weight_kg, activityLevel: profile.activity_level,
      deficitKcal: goal.daily_deficit_kcal,
    })
    : null;
  const targets = energy && goal ? calcDietTargets(energy.intake, goal.target_weight_kg) : null;
  const meals = targets ? mealSplit(targets) : [];
  const constraints = diseaseConstraints(
    diseases.map((d) => ({ name: d.name, presetKey: d.preset_key })),
  );

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* 本地存储不可用时仅本次有效 */ }
      return next;
    });
  };

  const exportList = async () => {
    try {
      const path = await saveDialog({
        defaultPath: `weightcoach-购物清单-${fmtDate(new Date())}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const payload = shoppingList().map((c) => ({
        category: c.category,
        items: c.items.map((name) => ({ name, checked: !!checked[`${c.category}|${name}`] })),
      }));
      await invoke("write_text_file", { path, content: JSON.stringify(payload, null, 2) });
      show("购物清单已导出");
    } catch (e) { showError(e, show); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="NUTRITION"
        title="饮食建议"
        subtitle="按目标摄入给参考份量；不做三餐记录，也不计算饮食依从。"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void exportList()}>
            <Download size={13} /> 导出购物清单
          </Button>
        }
      />

      {!targets ? (
        <Card title="目标摄入" eyebrow="TARGET">
          <Empty text={copy.diet.noProfile} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 min-[1000px]:grid-cols-4">
            <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary-soft/80 to-paper p-4 shadow-soft">
              <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">每日能量</div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="tabular text-[28px] font-semibold leading-none text-primary-deep">{targets.energy}</span>
                <span className="text-[10px] text-muted">kcal</span>
              </div>
              <div className="mt-1.5 text-[10px] text-muted">按目标摄入，不记录实际吃了什么</div>
            </div>
            <MacroCard label="蛋白质" value={targets.proteinG} range={targets.proteinRange} unit="g" />
            <MacroCard label="脂肪" value={targets.fatG} range={targets.fatRange} unit="g" />
            <MacroCard label="碳水" value={targets.carbG} range={targets.carbRange} unit="g" />
          </div>

          <Card title="一日分配" eyebrow="MACRO SPLIT" action={<Badge tone="muted">蛋白 / 脂肪 / 碳水</Badge>}>
            <MacroBar targets={targets} />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted">
              <span>膳食纤维 {targets.fiberG[0]}–{targets.fiberG[1]} g</span>
              <span>钠 &lt;{targets.sodiumMg} mg</span>
              <span>饮水 {targets.waterMl[0]}–{targets.waterMl[1]} ml</span>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-[1.2fr_1fr]">
            <Card
              title="疾病相关饮食约束"
              eyebrow="DISEASE-AWARE"
              action={<Badge tone={constraints.length ? "gold" : "muted"}>{constraints.length ? `${constraints.length} 条` : "无"}</Badge>}
            >
              {constraints.length === 0 ? (
                <p className="text-[12px] text-muted">未登记疾病，按基础目标给均衡建议。</p>
              ) : (
                <div className="space-y-2.5">
                  {constraints.map((c) => (
                    <div key={`${c.label}-${c.presetKey}`} className="rounded-xl border border-line/70 bg-bg/60 p-3">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink">
                        <ShieldCheck size={13} className="text-primary" /> {c.label}
                      </div>
                      <ul className="space-y-1 text-[10px] leading-relaxed text-muted">
                        {c.items.map((item) => (
                          <li key={item} className={item.includes("钠 <2000 mg") ? "font-medium text-accent" : ""}>· {item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="餐次模板" eyebrow="3 MEALS + 1 SNACK" action={<Badge tone="muted">30 / 35 / 30 / 5</Badge>}>
              <div className="space-y-2">
                {meals.map((m) => (
                  <div key={m.key} className="rounded-xl border border-line/60 bg-[#FBF9F5] p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-ink">{m.name}</span>
                      <span className="text-[9px] text-muted">{Math.round(m.ratio * 100)}% · 约 {m.energy} kcal</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted">{m.example}</p>
                    <p className="mt-1 text-[8.5px] text-muted/70">蛋白 {m.proteinG}g · 脂肪 {m.fatG}g · 碳水 {m.carbG}g</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card title="四类等份替换" eyebrow="SWAPS" action={<Badge tone="muted">按份量换，不按菜名换</Badge>}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {SWAP_GROUPS.map((group) => (
                <div key={group.category} className="rounded-2xl border border-line/70 p-3.5">
                  <div className="flex items-baseline justify-between">
                    <div className="text-[12px] font-medium text-ink">{group.category}</div>
                    <span className="text-[9px] text-muted">{group.options.length} 种</span>
                  </div>
                  <div className="mb-2 mt-1 text-[9px] text-muted">{group.note}</div>
                  <div className="space-y-1">
                    {group.options.map((o) => (
                      <div key={o.label} className="flex items-baseline justify-between rounded-lg bg-bg/60 px-2 py-1 text-[10px]">
                        <span>{o.label} · {o.portion}</span>
                        <span className="text-muted">约 {o.approxEnergy} kcal</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="外食策略" eyebrow="EATING OUT" action={<UtensilsCrossed size={15} className="text-muted" />}>
              <ul className="space-y-2 text-[11px] leading-relaxed text-muted">
                {EATING_OUT_TIPS.map((tip) => <li key={tip} className="flex gap-1.5"><span className="text-primary">·</span>{tip}</li>)}
              </ul>
            </Card>

            <Card
              title="购物清单"
              eyebrow="SHOPPING"
              action={<Button variant="secondary" size="sm" onClick={() => void exportList()}><Download size={12} /> 导出</Button>}
            >
              <div className="max-h-[300px] space-y-3 overflow-auto pr-1">
                {shoppingList().map((c) => (
                  <div key={c.category}>
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[1.2px] text-muted">{c.category}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.items.map((item) => {
                        const key = `${c.category}|${item}`;
                        return (
                          <label key={item} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors ${checked[key] ? "border-line bg-bg text-muted line-through" : "border-line/80 bg-paper hover:border-primary/30"}`}>
                            <input type="checkbox" checked={!!checked[key]} onChange={() => toggle(key)} className="h-3 w-3 accent-[#2F7D5F]" />
                            <span>{item}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <DietAiCard
            userId={userId}
            userName={user?.display_name ?? "成员"}
            targets={targets}
            diseases={diseases.map((d) => d.name)}
          />

          <p className="rounded-2xl bg-bg px-4 py-3 text-[10px] leading-relaxed text-muted">{DIET_DISCLAIMER || copy.diet.disclaimer}</p>
        </>
      )}
    </div>
  );
}

function MacroCard({ label, value, range, unit }: { label: string; value: number; range: [number, number]; unit: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
      <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-[24px] font-semibold leading-none text-ink">{value}</span>
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
      <div className="mt-1.5 text-[10px] text-muted/80">参考 {range[0]}–{range[1]} {unit}</div>
    </div>
  );
}

function MacroBar({ targets }: {
  targets: { proteinG: number; fatG: number; carbG: number; energy: number };
}) {
  const p = targets.proteinG * 4;
  const f = targets.fatG * 9;
  const c = targets.carbG * 4;
  const total = Math.max(1, p + f + c);
  const seg = [
    { label: "蛋白质", kcal: p, color: "#2F7D5F" },
    { label: "脂肪", kcal: f, color: "#C9A227" },
    { label: "碳水", kcal: c, color: "#D97757" },
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-line/60">
        {seg.map((s) => (
          <div key={s.label} style={{ width: `${(s.kcal / total) * 100}%`, backgroundColor: s.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
        {seg.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} {Math.round((s.kcal / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}
