import { useRef, useState } from "react";
import { Avatar, Button, Field, Input, Select } from "@/components/ui";
import { calcEnergy, calcGoalPeriod, customGoalPlan, recommendedGoalPlan, validateGoal } from "@/domain/energy";
import { firstError, validateBirthYear, validateHeight, validateMemberName, validateWaist, validateWeight } from "@/domain/validation";
import { searchCity, type CityHit } from "@/lib/weatherService";
import type { ActivityLevel, MemberInput, Sex } from "@/db/types";

export interface MemberDraft extends MemberInput {
  dailyDeficitKcal: number;
  goalMode: "recommended" | "custom";
  targetDate: string | null;
  avatar: string | null;
}

export const EMPTY_DRAFT: MemberDraft = {
  displayName: "",
  sex: "male",
  birthYear: 1990,
  heightCm: 170,
  activityLevel: "light",
  weightKg: 70,
  targetWeightKg: 65,
  cityId: "39.9042,116.4074",
  cityName: "北京",
  waistBaselineCm: null,
  constraints: [],
  dailyDeficitKcal: 400,
  goalMode: "recommended",
  targetDate: null,
  avatar: null,
};

export function fromMember(
  user: { display_name: string; color: string; avatar_data?: string | null },
  profile: { sex: Sex; birth_year: number; height_cm: number; activity_level: ActivityLevel; waist_baseline_cm: number | null; city_id: string | null; city_name: string | null; constraints_json: string },
  goal: { target_weight_kg: number; daily_deficit_kcal: number; target_date?: string | null },
  weightKg: number,
): MemberDraft {
  return {
    displayName: user.display_name,
    color: user.color,
    sex: profile.sex,
    birthYear: profile.birth_year,
    heightCm: profile.height_cm,
    activityLevel: profile.activity_level,
    weightKg,
    targetWeightKg: goal.target_weight_kg,
    dailyDeficitKcal: goal.daily_deficit_kcal,
    goalMode: goal.target_date ? "custom" : "recommended",
    targetDate: goal.target_date ?? null,
    avatar: user.avatar_data ?? null,
    cityId: profile.city_id,
    cityName: profile.city_name,
    waistBaselineCm: profile.waist_baseline_cm,
    constraints: JSON.parse(profile.constraints_json) as string[],
  };
}

/** 保存前按当前模式算出最终日期与缺口，避免 UI 派生值没有写进 draft。 */
export function withGoalPlan(d: MemberDraft): MemberDraft {
  if (d.goalMode === "custom" && d.targetDate) {
    const plan = customGoalPlan(d.weightKg, d.targetWeightKg, d.targetDate);
    if (plan.valid) return { ...d, dailyDeficitKcal: plan.deficit };
  }
  return { ...d, targetDate: null, dailyDeficitKcal: 400 };
}

export function validateProfileStep(d: MemberDraft): string | null {
  return firstError(
    validateMemberName(d.displayName),
    validateBirthYear(d.birthYear),
    validateHeight(d.heightCm),
    validateWeight(d.weightKg),
    d.waistBaselineCm == null ? { ok: true } : validateWaist(d.waistBaselineCm),
  );
}

export function validateGoalStep(d: MemberDraft): string | null {
  const goal = validateGoal(d.weightKg, d.targetWeightKg, d.heightCm);
  if (!goal.ok) return goal.reason;
  if (d.goalMode === "custom") {
    if (!d.targetDate) return "请选择自设达成日期";
    const plan = customGoalPlan(d.weightKg, d.targetWeightKg, d.targetDate);
    if (!plan.valid) return plan.reason ?? "自设达成时间不合理";
  }
  if (!Number.isFinite(d.dailyDeficitKcal)) return "每日缺口计算失败，请检查目标与日期";
  return null;
}

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "久坐（几乎不运动）",
  light: "轻度（每周 1–3 次）",
  moderate: "中度（每周 3–5 次）",
  active: "高强度（每周 6–7 次）",
};

const CONSTRAINT_LABELS: Record<string, string> = {
  knee: "膝部禁忌",
  waist: "腰部禁忌",
  cardio: "心肺禁忌",
};

async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  // 用 data URL，避免 CSP 只允许 'self' data: 时 blob: 图片加载失败
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = dataUrl;
  });
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法处理图片");
  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function AvatarPicker({ name, color, avatar, onChange }: {
  name: string;
  color?: string;
  avatar: string | null;
  onChange: (avatar: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await fileToAvatar(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "头像处理失败");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line/70 bg-bg/40 p-3">
      <Avatar name={name || "?"} color={color} src={avatar} size={64} className="rounded-2xl" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink">成员头像</div>
        <div className="mt-0.5 text-[10px] text-muted">JPG / PNG，自动裁成 256×256；所有人可修改自己的头像</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "处理中…" : avatar ? "更换头像" : "上传头像"}
          </Button>
          {avatar && <Button variant="ghost" size="sm" onClick={() => onChange(null)}>移除</Button>}
        </div>
        {error && <div className="mt-1 text-[10px] text-accent">{error}</div>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}

function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minCustomDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return fmtLocal(d);
}

function CityField({ cityName, onChange }: {
  cityId: string | null;
  cityName: string;
  onChange: (patch: Partial<MemberDraft>) => void;
}) {
  const [keyword, setKeyword] = useState(cityName);
  const [hits, setHits] = useState<CityHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!keyword.trim()) return;
    setBusy(true);
    setSearched(false);
    try {
      setHits(await searchCity(keyword.trim()));
      setSearched(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label="城市" hint="搜索后点选结果；天气与本周计划使用这个城市">
      <div className="flex gap-2">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          placeholder="输入城市名，如 北京 / 上海"
        />
        <Button variant="secondary" disabled={busy || !keyword.trim()} onClick={() => void search()}>
          {busy ? "搜索中" : "搜索"}
        </Button>
      </div>
      {hits.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line/70">
          {hits.slice(0, 6).map((hit) => (
            <button
              key={hit.id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] hover:bg-primary-soft/40"
              onClick={() => {
                const name = `${hit.name}${hit.region ? ` · ${hit.region}` : ""}`;
                onChange({ cityId: hit.id, cityName: name });
                setKeyword(hit.name);
                setHits([]);
              }}
            >
              <span>{hit.name}</span>
              <span className="text-[10px] text-muted">{hit.region}</span>
            </button>
          ))}
        </div>
      )}
      {searched && hits.length === 0 && <p className="mt-1.5 text-[10px] text-accent">没有找到城市，请换一个关键词。</p>}
      <p className="mt-1.5 text-[10px] text-muted">当前：{cityName || "未设置"}</p>
    </Field>
  );
}

export function MemberForm({ draft, onChange, step }: {
  draft: MemberDraft;
  onChange: (patch: Partial<MemberDraft>) => void;
  step: "profile" | "goal" | "full";
}) {
  const recommended = recommendedGoalPlan(draft.weightKg, draft.targetWeightKg);
  const custom = draft.targetDate
    ? customGoalPlan(draft.weightKg, draft.targetWeightKg, draft.targetDate)
    : null;
  const planDeficit = draft.goalMode === "custom" && custom?.valid ? custom.deficit : recommended.deficit;

  const energy = calcEnergy({
    sex: draft.sex,
    birthYear: draft.birthYear,
    heightCm: draft.heightCm,
    weightKg: draft.weightKg,
    activityLevel: draft.activityLevel,
    deficitKcal: planDeficit,
  });
  const period = calcGoalPeriod(draft.weightKg, draft.targetWeightKg, draft.heightCm);
  const goalCheck = validateGoal(draft.weightKg, draft.targetWeightKg, draft.heightCm);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {(step === "profile" || step === "full") && (
        <>
          <div className="sm:col-span-2">
            <AvatarPicker
              name={draft.displayName}
              color={draft.color}
              avatar={draft.avatar}
              onChange={(avatar) => onChange({ avatar })}
            />
          </div>
          <Field label="姓名">
            <Input value={draft.displayName} maxLength={12} onChange={(e) => onChange({ displayName: e.target.value })} placeholder="≤12 字" />
          </Field>
          <Field label="性别">
            <Select value={draft.sex} onChange={(e) => onChange({ sex: e.target.value as Sex })}>
              <option value="male">男</option>
              <option value="female">女</option>
            </Select>
          </Field>
          <Field label="出生年">
            <Input type="number" value={draft.birthYear} onChange={(e) => onChange({ birthYear: Number(e.target.value) })} />
          </Field>
          <Field label="身高（cm）">
            <Input type="number" value={draft.heightCm} onChange={(e) => onChange({ heightCm: Number(e.target.value) })} />
          </Field>
          <Field label="活动水平">
            <Select value={draft.activityLevel} onChange={(e) => onChange({ activityLevel: e.target.value as ActivityLevel })}>
              {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="当前体重（kg）">
            <Input type="number" step="0.1" value={draft.weightKg} onChange={(e) => onChange({ weightKg: Number(e.target.value) })} />
          </Field>
          <Field label="腰围基线（cm，选填）">
            <Input type="number" step="0.1" value={draft.waistBaselineCm ?? ""} onChange={(e) => onChange({ waistBaselineCm: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
          <CityField
            cityId={draft.cityId ?? null}
            cityName={draft.cityName ?? ""}
            onChange={(patch) => onChange(patch)}
          />
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">运动禁忌（仅用于计划过滤）</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CONSTRAINT_LABELS).map(([key, label]) => (
                <label key={key} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] ${draft.constraints?.includes(key) ? "border-primary/30 bg-primary-soft text-primary-deep" : "border-line bg-paper text-muted"}`}>
                  <input
                    type="checkbox"
                    className="h-3 w-3 accent-[#2F7D5F]"
                    checked={draft.constraints?.includes(key) ?? false}
                    onChange={(e) => {
                      const set = new Set(draft.constraints ?? []);
                      if (e.target.checked) set.add(key); else set.delete(key);
                      onChange({ constraints: [...set] });
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </>
      )}

      {(step === "goal" || step === "full") && (
        <>
          <Field label="目标体重（kg）" error={goalCheck.ok ? null : goalCheck.reason}>
            <Input type="number" step="0.1" value={draft.targetWeightKg} onChange={(e) => onChange({ targetWeightKg: Number(e.target.value) })} />
          </Field>
          <div className="hidden sm:block" />

          <div className="sm:col-span-2 rounded-2xl border border-line/70 bg-bg/40 p-3.5">
            <div className="mb-1 text-[11px] font-medium text-ink">达成时间与每日热量缺口</div>
            <p className="mb-2.5 text-[10px] leading-relaxed text-muted">推荐按 400 kcal/天 估算；自设日期会反算所需缺口，不再限制上下限，按你的节奏来。</p>

            <button
              type="button"
              onClick={() => onChange({ goalMode: "recommended", targetDate: null, dailyDeficitKcal: 400 })}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                draft.goalMode === "recommended" ? "border-primary/40 bg-primary-soft/50" : "border-line/70 bg-paper hover:border-primary/25"
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${draft.goalMode === "recommended" ? "border-primary bg-primary" : "border-line"}`}>
                {draft.goalMode === "recommended" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[12px] font-medium text-ink">推荐达成时间</span>
                  <span className="text-[10px] text-primary">约 {recommended.weeks} 周 · {recommended.date}</span>
                </span>
                <span className="mt-0.5 block text-[10px] text-muted">每日缺口 {recommended.deficit} kcal · 稳定、易坚持</span>
              </span>
            </button>

            <div className={`mt-2 rounded-xl border p-3 transition-colors ${
              draft.goalMode === "custom" ? "border-primary/40 bg-primary-soft/50" : "border-line/70 bg-paper"
            }`}>
              <button
                type="button"
                onClick={() => onChange({ goalMode: "custom", targetDate: draft.targetDate ?? recommended.date })}
                className="flex w-full items-start gap-3 text-left"
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${draft.goalMode === "custom" ? "border-primary bg-primary" : "border-line"}`}>
                  {draft.goalMode === "custom" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[12px] font-medium text-ink">自设达成时间</span>
                  <span className="mt-0.5 block text-[10px] text-muted">按你的日期反算每日缺口</span>
                </span>
              </button>
              {draft.goalMode === "custom" && (
                <div className="mt-2 pl-7">
                  <Input
                    type="date"
                    min={minCustomDate()}
                    value={draft.targetDate ?? ""}
                    onChange={(e) => onChange({ targetDate: e.target.value })}
                    className="max-w-[220px]"
                  />
                  {custom && (
                    <div className={`mt-1.5 text-[10px] ${custom.valid ? "text-primary" : "text-accent"}`}>
                      {custom.valid
                        ? `每日缺口 ${custom.deficit} kcal · 约 ${custom.days} 天`
                        : custom.reason}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-paper px-3 py-2 text-[10px] text-muted">
              <span>当前采用：<b className="text-ink">{planDeficit} kcal/天</b></span>
              <span>推荐区间 {period.weeksFast}–{period.weeksSlow} 周</span>
            </div>
          </div>

          <div className="sm:col-span-2 rounded-xl bg-bg p-4 text-sm">
            <div className="mb-2 font-medium">按当前数据测算</div>
            <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-2">
              <span className="text-muted">基础代谢 BMR</span><span>{energy.bmr} kcal/天</span>
              <span className="text-muted">总消耗 TDEE</span><span>{energy.tdee} kcal/天</span>
              <span className="text-muted">目标摄入</span><span className="font-medium text-primary">{energy.intake} kcal/天</span>
              <span className="text-muted">预计周期</span><span>{period.weeksFast}–{period.weeksSlow} 周</span>
            </div>
            {period.targetBmi < 18.5 && <p className="mt-2 text-danger">目标 BMI 低于 18.5，请调整目标体重。</p>}
            {period.weeksFast > 52 && <p className="mt-2 text-accent">目标较远，仍可保存。</p>}
          </div>
        </>
      )}
    </div>
  );
}
