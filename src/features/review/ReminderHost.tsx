import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Button, Card, Modal, useToast } from "@/components/ui";
import { useUser } from "@/app/UserContext";
import {
  measurementRepo,
  reminderRepo,
  settingsRepo,
  SETTINGS,
} from "@/db/repositories";
import { todayStr } from "@/db/client";
import type { MedDueItem } from "@/db/types";
import {
  isQuietHours,
  mondayBasedWeekday,
  mondayOf,
  shouldPromptReviewOnBoot,
  shouldPromptWeightOnBoot,
} from "@/domain/adherence";
import { WeightModal } from "@/features/records/WeightModal";

type Reminder = "weight" | "medication" | "review";

/** 稍后 10 分钟重提醒：记录到内存 Map，定时重新入队（SRS FR-RMD-06）。 */

interface MedGroup {
  user_id: string;
  display_name: string;
  items: MedDueItem[];
}

export function ReminderHost() {
  const { user } = useUser();
  const navigate = useNavigate();
  const { show } = useToast();
  const [queue, setQueue] = useState<Reminder[]>([]);
  const active = queue[0] ?? null;
  const [snoozed, setSnoozed] = useState<Record<Reminder, number>>({ weight: 0, medication: 0, review: 0 });
  const checkedRef = useRef(false);

  const enqueue = useCallback((r: Reminder) => {
    setQueue((q) => (q.includes(r) ? q : [...q, r]));
  }, []);
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  // 稍后 10 分钟：到点重入队；若处于免打扰时段则延后到 06:00（SRS 10.3）
  const snooze = useCallback((r: Reminder) => {
    const now = new Date();
    let target = new Date(now.getTime() + 10 * 60 * 1000);
    if (isQuietHours(target.getHours())) {
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (target.getHours() >= 23 ? 1 : 0), 6, 0, 0);
    }
    setSnoozed((s) => ({ ...s, [r]: target.getTime() }));
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const due = (Object.keys(snoozed) as Reminder[]).filter((r) => snoozed[r] > 0 && snoozed[r] <= now);
      if (!due.length) return;
      setSnoozed((s) => {
        const next = { ...s };
        for (const r of due) {
          next[r] = 0;
          enqueue(r);
        }
        return next;
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [snoozed, enqueue]);

  // 开机检查（SRS 10.1）：只弹一个；用药 > 复盘 > 体重
  useEffect(() => {
    if (checkedRef.current || !user) return;
    checkedRef.current = true;
    void (async () => {
      try {
        const now = new Date();
        const today = todayStr();
        const enabledWeight = await settingsRepo.get(SETTINGS.reminderWeight);
        const enabledMed = await settingsRepo.get(SETTINGS.reminderMed);
        const enabledReview = await settingsRepo.get(SETTINGS.reminderReview);
        // 用药（21:00 后或全家晚间未打卡）
        if (enabledMed !== "0" && now.getHours() >= 21 && await reminderRepo.hasUntakenEvening(today)) {
          enqueue("medication");
          await settingsRepo.set(SETTINGS.lastMedPromptDate, today);
          return;
        }
        // 复盘（周一上午）
        const wd = mondayBasedWeekday(now);
        if (enabledReview !== "0") {
          const thisMon = mondayOf(now);
          const lastWeekMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - wd - 7);
          const from = `${lastWeekMon.getFullYear()}-${String(lastWeekMon.getMonth() + 1).padStart(2, "0")}-${String(lastWeekMon.getDate()).padStart(2, "0")}`;
          const lastWeekSun = new Date(lastWeekMon); lastWeekSun.setDate(lastWeekSun.getDate() + 6);
          const to = `${lastWeekSun.getFullYear()}-${String(lastWeekSun.getMonth() + 1).padStart(2, "0")}-${String(lastWeekSun.getDate()).padStart(2, "0")}`;
          if (shouldPromptReviewOnBoot({
            weekday: wd, hour: now.getHours(),
            hasLastWeekData: await reminderRepo.lastWeekHasData(user.id, from, to),
            lastPromptWeek: await settingsRepo.get(SETTINGS.lastReviewPromptWeek),
            thisMonday: thisMon,
          })) {
            enqueue("review");
            await settingsRepo.set(SETTINGS.lastReviewPromptWeek, thisMon);
            return;
          }
        }
        // 体重（05–10:59）
        if (enabledWeight !== "0") {
          const lastPrompt = await settingsRepo.get(SETTINGS.lastWeightPromptDate);
          if (shouldPromptWeightOnBoot({
            hour: now.getHours(),
            hasWeightToday: await measurementRepo.hasOnDate(user.id, today),
            lastPromptDate: lastPrompt,
            today,
          })) {
            enqueue("weight");
            await settingsRepo.set(SETTINGS.lastWeightPromptDate, today);
          }
        }
      } catch { /* 开机检查失败不阻塞主界面 */ }
    })();
  }, [user, enqueue]);

  // 监听 Rust 定时器与托盘事件
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const hook = (event: string, handler: () => void | Promise<void>) => {
      void listen(event, () => { void handler(); }).then((u) => unsubs.push(u));
    };
    hook("reminder://weight", async () => {
      if (!user) return;
      const today = todayStr();
      const last = await settingsRepo.get(SETTINGS.lastWeightPromptDate);
      if (isQuietHours(new Date().getHours())) return;
      if (await measurementRepo.hasOnDate(user.id, today)) return;
      if (last === today) return;
      enqueue("weight");
      await settingsRepo.set(SETTINGS.lastWeightPromptDate, today);
    });
    hook("reminder://medication", async () => {
      const today = todayStr();
      if (isQuietHours(new Date().getHours())) return;
      if (!await reminderRepo.hasUntakenEvening(today)) return;
      enqueue("medication");
      await settingsRepo.set(SETTINGS.lastMedPromptDate, today);
    });
    hook("reminder://review", () => enqueue("review"));
    hook("tray://log-weight", () => enqueue("weight"));
    hook("tray://med-check", () => enqueue("medication"));
    return () => unsubs.forEach((u) => u());
  }, [user, enqueue]);

  const refreshAll = useCallback(() => {
    // 提醒保存后刷新今日页等查询（用事件广播，避免强依赖 useQueryClient 类型）
    window.dispatchEvent(new CustomEvent("weightcoach:refresh"));
  }, []);

  if (!active) return null;
  return (
    <>
      {active === "weight" && user && (
        <WeightModal
          userId={user.id}
          reminder
          onClose={dismiss}
          onSaved={() => { refreshAll(); show("已记录体重"); }}
          onSnooze={() => snooze("weight")}
          onTodayOff={async () => { await settingsRepo.set(SETTINGS.lastWeightPromptDate, todayStr()); dismiss(); }}
        />
      )}
      {active === "medication" && (
        <MedicationReminder onClose={dismiss} onSnooze={() => snooze("medication")} />
      )}
      {active === "review" && (
        <Modal
          title="该做周复盘了"
          onClose={dismiss}
          footer={<><Button variant="secondary" onClick={dismiss}>关闭</Button><Button onClick={() => { dismiss(); navigate("/review/current"); }}>查看详情</Button></>}
        >
          <Card title="上周回顾">
            <p className="text-sm text-muted">体重变化、腰围、运动、用药依从、指标、记录完成率 —— 六项回顾等你查看。数据不足时会标注「样本不足」。</p>
          </Card>
        </Modal>
      )}
    </>
  );
}

function MedicationReminder({ onClose, onSnooze }: { onClose: () => void; onSnooze: () => void }) {
  const { show } = useToast();
  const today = todayStr();
  const [groups, setGroups] = useState<MedGroup[]>([]);
  useEffect(() => {
    void reminderRepo.untakenEveningByUser(today).then(setGroups);
  }, [today]);
  const checkIn = async (userId: string, slotId: string) => {
    // 通过 medicationLogRepo 打卡；user_id 由 slot 外键保证
    const { medicationLogRepo } = await import("@/db/repositories");
    await medicationLogRepo.checkIn(userId, slotId, today, "taken");
    setGroups((gs) => gs.map((g) => ({
      ...g,
      items: g.items.filter((i) => i.slot_id !== slotId),
    })).filter((g) => g.items.length > 0));
    window.dispatchEvent(new CustomEvent("weightcoach:refresh"));
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="max-h-[80vh] w-[520px] overflow-auto rounded-lg bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">该用药了（晚间）</h2>
          <button className="text-muted hover:text-text" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">全家晚间用药都已打卡。</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.user_id}>
                <div className="mb-2 text-sm font-medium">{g.display_name}</div>
                <div className="space-y-1">
                  {g.items.map((i) => (
                    <label key={i.slot_id} className="flex items-center gap-2 rounded bg-bg px-3 py-2 text-sm">
                      <input type="checkbox" onChange={() => void checkIn(g.user_id, i.slot_id).catch(() => show("打卡失败，请重试", "error"))} />
                      <span>{i.time_of_day} · {i.name} <span className="text-xs text-muted">{i.dose} {i.dose_unit}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onSnooze}>稍后 10 分钟</Button>
          <Button onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  );
}
