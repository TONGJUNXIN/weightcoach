import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, Lock, Pill, Scale, ShieldCheck, Sparkles } from "lucide-react";
import { Button, showError, useToast } from "@/components/ui";
import { userRepo, settingsRepo, SETTINGS } from "@/db/repositories";
import { EMPTY_DRAFT, MemberForm, validateGoalStep, validateProfileStep, withGoalPlan, type MemberDraft } from "@/features/users/MemberForm";
import { copy } from "@/lib/copy";
import appIcon from "@/assets/app-icon.png?inline";

const steps = ["欢迎", "档案", "目标", "提醒"];

export function OnboardingPage({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState({ autostart: true, weight: true, med: true, review: true });
  const { show } = useToast();

  const persist = async (chosen: typeof reminders) => {
    setSaving(true);
    try {
      await userRepo.createOwner(withGoalPlan(draft));
      await settingsRepo.set(SETTINGS.autostart, chosen.autostart ? "1" : "0");
      await invoke("set_autostart", { enabled: chosen.autostart });
      await settingsRepo.set(SETTINGS.reminderWeight, chosen.weight ? "1" : "0");
      await settingsRepo.set(SETTINGS.reminderMed, chosen.med ? "1" : "0");
      await settingsRepo.set(SETTINGS.reminderReview, chosen.review ? "1" : "0");
      onDone();
    } catch (e) {
      showError(e, show);
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (step === 1) {
      const message = validateProfileStep(draft);
      if (message) { setError(message); return; }
    }
    if (step === 2) {
      const message = validateGoalStep(draft);
      if (message) { setError(message); return; }
    }
    setError(null);
    if (step < 3) { setStep(step + 1); return; }
    await persist(reminders);
  };

  const useDefaults = async () => {
    const all = { autostart: true, weight: true, med: true, review: true };
    setReminders(all);
    setError(null);
    await persist(all);
  };

  return (
    <div className="min-h-screen overflow-auto bg-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-[1120px] items-center justify-center gap-12 px-6 py-10">
        <aside className="hidden w-[300px] shrink-0 lg:block">
          <img src={appIcon} alt="" className="h-16 w-16 rounded-[18px] shadow-card" />
          <h1 className="mt-6 text-[30px] font-semibold leading-tight tracking-[-.5px] text-ink">
            记录，<br />不用记太多。
          </h1>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            体重、用药、运动和一点点趋势，就够了。剩下的交给提醒和周复盘。
          </p>
          <div className="mt-6 space-y-3">
            {[
              { icon: Scale, title: "轻量记录", desc: "每天 10 秒，记一笔体重或运动" },
              { icon: Pill, title: "按时提醒", desc: "体重、用药、周复盘，免打扰时段不打扰" },
              { icon: Sparkles, title: "AI 可选", desc: "默认关闭；开启后只发送你允许的字段" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><f.icon size={14} /></span>
                <div>
                  <div className="text-[11px] font-medium text-ink">{f.title}</div>
                  <div className="mt-0.5 text-[9.5px] leading-relaxed text-muted">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-7 flex items-center gap-1.5 text-[9px] text-muted/70"><Lock size={11} /> 数据只保存在本机，不上传</div>
        </aside>

        <main className="w-full max-w-[720px]">
          <div className="rounded-3xl border border-line/80 bg-paper p-6 shadow-card sm:p-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <img src={appIcon} alt="" className="h-10 w-10 rounded-xl shadow-sm" />
              <div>
                <div className="text-[15px] font-semibold text-ink">{copy.app.name}</div>
                <div className="text-[8px] font-medium tracking-[2px] text-muted">WEIGHT COACH</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {steps.map((s, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <div key={s} className="flex flex-1 items-center gap-1.5">
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
                      active ? "bg-primary text-white" : done ? "bg-primary-soft text-primary" : "bg-bg text-muted"
                    }`}>
                      {done ? "✓" : i + 1}
                    </div>
                    <span className={`hidden text-[10px] sm:block ${active ? "font-medium text-primary" : "text-muted"}`}>{s}</span>
                    {i < steps.length - 1 && <div className={`h-px flex-1 ${done ? "bg-primary/30" : "bg-line"}`} />}
                  </div>
                );
              })}
            </div>

            <div className="mt-7 min-h-[300px]">
              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <div className="text-[9px] font-medium uppercase tracking-[2px] text-muted">WELCOME</div>
                    <h2 className="mt-1.5 text-[24px] font-semibold leading-tight text-ink">在本地记录体重与用药，按时提醒你。</h2>
                    <p className="mt-1.5 text-[11px] text-muted">家庭多用户 · 轻量记录 · 慢病登记 · AI 可选</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {["只记「是 / 否」", "不计算运动消耗", "不做诊断", "不记录三餐"].map((t) => (
                      <span key={t} className="rounded-full border border-line/70 bg-bg/60 px-2.5 py-1 text-[9.5px] text-muted">{t}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="rounded-2xl border border-line/60 bg-[#FBF9F5] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink"><ShieldCheck size={13} className="text-primary" /> 免责声明</div>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-muted">只做记录、提醒与生活方式建议，不提供诊断、用药或剂量建议；身体不适请咨询医生。</p>
                    </div>
                    <div className="rounded-2xl border border-line/60 bg-[#FBF9F5] p-3.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink"><Lock size={13} className="text-primary" /> 隐私说明</div>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-muted">数据全部保存在本机，不上传；AI 默认关闭，开启后由你选择服务商。卸载不会删除记录。</p>
                    </div>
                  </div>
                </div>
              )}
              {step === 1 && (
                <MemberForm draft={draft} step="profile" onChange={(patch) => setDraft({ ...draft, ...patch })} />
              )}
              {step === 2 && (
                <MemberForm draft={draft} step="goal" onChange={(patch) => setDraft({ ...draft, ...patch })} />
              )}
              {step === 3 && (
                <div className="space-y-3">
                  <div>
                    <div className="text-[9px] font-medium uppercase tracking-[2px] text-muted">REMINDERS</div>
                    <h2 className="mt-1.5 text-[18px] font-semibold text-ink">把提醒设在合适的时间</h2>
                    <p className="mt-1 text-[10px] text-muted">均可稍后在设置中修改，也可以全部使用默认。</p>
                  </div>
                  <div className="divide-y divide-line/60 rounded-2xl border border-line/70 bg-[#FBF9F5] px-3.5">
                    {([
                      ["autostart", "开机自动启动", "登录 Windows 后自动打开"],
                      ["weight", "07:00 体重记录提醒", "起床后提醒称重"],
                      ["med", "21:00 用药提醒", "按登记时段提醒"],
                      ["review", "周一 08:30 周复盘", "提醒回看上一周"],
                    ] as const).map(([key, label, desc]) => (
                      <div key={key} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <div className="text-[11px] font-medium text-ink">{label}</div>
                          <div className="mt-0.5 text-[9px] text-muted">{desc}</div>
                        </div>
                        <Toggle checked={reminders[key]} onChange={(v) => setReminders({ ...reminders, [key]: v })} />
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] leading-relaxed text-muted">23:00–06:00 免打扰，期间不弹任何提醒。</p>
                </div>
              )}
            </div>

            {error && <div className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-[10px] text-accent">{error}</div>}

            <div className="mt-6 flex items-center justify-between border-t border-line/60 pt-4">
              <Button variant="ghost" disabled={step === 0 || saving} onClick={() => { setError(null); setStep(step - 1); }}>
                <ChevronLeft size={14} /> 上一步
              </Button>
              <div className="flex gap-2">
                {step === 3 && <Button variant="secondary" disabled={saving} onClick={() => void useDefaults()}>使用默认提醒</Button>}
                <Button disabled={saving} onClick={() => void next()}>
                  {step === 3 ? (saving ? "正在保存…" : "完成") : "下一步"}
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[9px] text-muted/70">继续即表示你已阅读免责声明与隐私说明</p>
        </main>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}
