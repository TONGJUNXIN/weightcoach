import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, MapPin, Pencil, Ruler, Scale, ShieldAlert, Target } from "lucide-react";
import { Avatar, Badge, Button, Card, Modal, PageHeader, showError, useToast } from "@/components/ui";
import { useUser } from "@/app/UserContext";
import { diseaseRepo, goalRepo, measurementRepo, profileRepo, userRepo } from "@/db/repositories";
import { calcEnergy, calcGoalPeriod } from "@/domain/energy";
import { EMPTY_DRAFT, fromMember, MemberForm, validateGoalStep, validateProfileStep, withGoalPlan, type MemberDraft } from "@/features/users/MemberForm";

const ACTIVITY_LABEL: Record<string, string> = {
  sedentary: "久坐", light: "轻度活动", moderate: "中度活动", active: "高强度活动",
};

export function ProfilePage() {
  const { user, refresh } = useUser();
  const { show } = useToast();
  const userId = user?.id ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["profile", userId], enabled: !!userId, queryFn: () => profileRepo.get(userId),
  });
  const { data: goal, refetch: refetchGoal } = useQuery({
    queryKey: ["goal", userId], enabled: !!userId, queryFn: () => goalRepo.get(userId),
  });
  const { data: latest, refetch: refetchWeight } = useQuery({
    queryKey: ["measurement", "latest", userId], enabled: !!userId, queryFn: () => measurementRepo.latest(userId),
  });
  const { data: diseases = [] } = useQuery({
    queryKey: ["diseases", userId], enabled: !!userId, queryFn: () => diseaseRepo.list(userId),
  });

  useEffect(() => {
    if (user && profile && goal && latest) {
      setDraft(fromMember(user, profile, goal, latest.weight_kg));
    }
  }, [user, profile, goal, latest]);

  const energy = profile && goal && latest
    ? calcEnergy({
        sex: profile.sex, birthYear: profile.birth_year, heightCm: profile.height_cm,
        weightKg: latest.weight_kg, activityLevel: profile.activity_level,
        deficitKcal: goal.daily_deficit_kcal,
      })
    : null;
  const period = latest && goal && profile
    ? calcGoalPeriod(latest.weight_kg, goal.target_weight_kg, profile.height_cm)
    : null;

  const save = async () => {
    if (!user) return;
    const message = validateProfileStep(draft) ?? validateGoalStep(draft);
    if (message) { setError(message); return; }
    try {
      await userRepo.updateMember(user.id, user.id, withGoalPlan(draft));
      await Promise.all([refetchProfile(), refetchGoal(), refetchWeight(), refresh()]);
      setEditing(false);
    } catch (e) { showError(e, show); }
  };

  const constraintLabels: Record<string, string> = { knee: "膝部", waist: "腰部", cardio: "心肺" };
  const constraints = (() => {
    try { return JSON.parse(profile?.constraints_json ?? "[]") as string[]; } catch { return []; }
  })();
  const remaining = latest && goal ? Math.max(0, latest.weight_kg - goal.target_weight_kg) : null;
  const reached = remaining !== null && remaining <= 0.05;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PROFILE"
        title="档案与目标"
        subtitle={`${user?.display_name ?? "成员"} 的身体数据与目标设置`}
        actions={<Button onClick={() => { setError(null); setEditing(true); }}><Pencil size={14} /> 编辑档案与目标</Button>}
      />

      <div className="overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary-soft/80 via-[#F2F8F4] to-paper p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Avatar name={user?.display_name ?? "我"} color={user?.color} src={user?.avatar_data} size={56} className="rounded-2xl shadow-sm" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[18px] font-semibold text-ink">{user?.display_name}</span>
                <Badge tone="teal">{reached ? "已达目标" : "进行中"}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                <span className="inline-flex items-center gap-1"><MapPin size={10} /> {profile?.city_name ?? "未设置城市"}</span>
                <span>{profile ? ACTIVITY_LABEL[profile.activity_level] : "—"}</span>
                <span>{profile ? `${profile.height_cm} cm` : "—"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-end gap-6">
            <div>
              <div className="text-[9px] uppercase tracking-[1.8px] text-muted">当前体重</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="tabular text-[38px] font-semibold leading-none text-ink">{latest?.weight_kg ?? "—"}</span>
                <span className="text-[11px] text-muted">kg</span>
              </div>
            </div>
            <div className="border-l border-primary/15 pl-6">
              <div className="text-[9px] uppercase tracking-[1.8px] text-muted">目标体重</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="tabular text-[28px] font-semibold leading-none text-primary">{goal?.target_weight_kg ?? "—"}</span>
                <span className="text-[11px] text-muted">kg</span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-paper/70 px-3.5 py-2.5 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1.5"><ShieldAlert size={12} className="text-primary" /> 运动禁忌：{constraints.map((c) => constraintLabels[c] ?? c).join("、") || "无"}</span>
          <span className="inline-flex items-center gap-1.5"><Target size={12} className="text-primary" /> {reached ? "已到目标，保持即可" : `还差 ${remaining?.toFixed(1) ?? "—"} kg`}</span>
          <span className="inline-flex items-center gap-1.5"><Scale size={12} className="text-primary" /> 每日缺口 {goal?.daily_deficit_kcal ?? "—"} kcal</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-2">
        <Card title="身体档案" eyebrow="BODY" action={<Ruler size={15} className="text-muted" />}>
          {profile ? (
            <div className="grid grid-cols-2 gap-3">
              <InfoTile label="性别 / 出生年" value={`${profile.sex === "male" ? "男" : "女"} · ${profile.birth_year}`} />
              <InfoTile label="身高" value={`${profile.height_cm} cm`} />
              <InfoTile label="当前体重" value={`${latest?.weight_kg ?? "—"} kg`} />
              <InfoTile label="腰围基线" value={`${profile.waist_baseline_cm ?? "—"} cm`} />
              <InfoTile label="活动水平" value={ACTIVITY_LABEL[profile.activity_level] ?? profile.activity_level} />
              <InfoTile label="城市" value={profile.city_name ?? "未设置"} />
            </div>
          ) : <p className="text-sm text-muted">档案未建立</p>}
        </Card>

        <Card title="目标与测算" eyebrow="ENERGY" action={<Activity size={15} className="text-muted" />}>
          {goal && energy && period ? (
            <div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[9px] uppercase tracking-[1.8px] text-muted">目标摄入</div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="tabular text-[32px] font-semibold leading-none text-primary">{energy.intake}</span>
                    <span className="text-[10px] text-muted">kcal / 天</span>
                  </div>
                </div>
                <Badge tone="muted">BMR {energy.bmr} · TDEE {energy.tdee}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <InfoTile label="目标体重" value={`${goal.target_weight_kg} kg`} />
                <InfoTile label="每日缺口" value={`${goal.daily_deficit_kcal} kcal`} />
                <InfoTile label="预计周期" value={`${period.weeksFast}–${period.weeksSlow} 周`} />
                <InfoTile label="达成日期" value={goal.target_date ? `自设 ${goal.target_date}` : `推荐 ${period.etaEnd}`} />
                <InfoTile label="日期区间" value={`${period.etaStart} ~ ${period.etaEnd}`} />
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-line/60">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(6, (1 - (remaining ?? 0) / Math.max(1, goal.target_weight_kg)) * 100))}%` }} />
              </div>
              <p className="mt-1.5 text-[9px] text-muted">进度条按“当前体重 → 目标体重”粗略展示，不作为医学判断。</p>
            </div>
          ) : <p className="text-sm text-muted">目标未建立</p>}
        </Card>
      </div>

      <Card title="健康约束" eyebrow="HEALTH" action={<Link to="/diseases" className="text-[10px] font-medium text-primary hover:underline">管理疾病与指标 →</Link>}>
        {diseases.length === 0 ? (
          <p className="text-[11px] text-muted">还没有登记疾病。这里只做登记，不提供诊断或用药建议。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {diseases.map((d) => (
              <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-bg/60 px-3 py-1 text-[10px] text-text">
                <ShieldAlert size={11} className="text-primary" /> {d.name}
                <span className="text-[8.5px] text-muted">{d.preset_key ? "预置" : "自定义"}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <Modal
          title="编辑档案与目标"
          width="xl"
          dismissable={false}
          onClose={() => setEditing(false)}
          footer={<><Button variant="secondary" onClick={() => setEditing(false)}>取消</Button><Button onClick={() => void save()}>保存</Button></>}
        >
          {error && <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-[11px] text-accent">{error}</p>}
          <MemberForm draft={draft} step="full" onChange={(patch) => setDraft({ ...draft, ...patch })} />
        </Modal>
      )}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/60 bg-[#FBF9F5] px-3 py-2.5">
      <div className="text-[9px] text-muted">{label}</div>
      <div className="mt-0.5 text-[11px] font-medium text-ink">{value}</div>
    </div>
  );
}
