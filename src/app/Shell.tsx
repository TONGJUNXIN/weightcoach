import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CalendarCheck2, CalendarDays, Check, ChevronDown, ClipboardList, Home, Pill,
  Salad, Settings, Sparkles, TrendingUp, Plus, Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { userRepo } from "@/db/repositories";
import { useUser } from "./UserContext";
import { Avatar, Button, showError, useToast, Modal, Input, Field } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { ReminderHost } from "@/features/review/ReminderHost";
import { WeightModal } from "@/features/records/WeightModal";
import appIcon from "@/assets/app-icon.png?inline";

type NavItem = { to: string; label: string; icon: LucideIcon };

const nav: NavItem[] = [
  { to: "/today", label: "今日", icon: Home },
  { to: "/records", label: "记录", icon: ClipboardList },
  { to: "/trends", label: "趋势", icon: TrendingUp },
  { to: "/medications", label: "用药", icon: Pill },
  { to: "/review/current", label: "复盘", icon: CalendarCheck2 },
  { to: "/plan", label: "本周计划", icon: CalendarDays },
  { to: "/diet", label: "饮食建议", icon: Salad },
  { to: "/ai", label: "AI 问答", icon: Sparkles },
];

function UserSwitcher() {
  const { user, switchTo, switching } = useUser();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const { data: members = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => userRepo.list(),
  });
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        disabled={switching}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-line/80 bg-paper px-3 py-2.5 text-left shadow-soft transition-colors hover:border-primary/20 disabled:opacity-50"
      >
        <Avatar name={user?.display_name ?? "?"} color={user?.color} src={user?.avatar_data} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{user?.display_name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted">户主 · 当前账本</span>
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl border border-line bg-paper p-1.5 shadow-lift">
            {members.map((m) => (
              <button
                key={m.id}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-bg"
                onClick={async () => {
                  setOpen(false);
                  await switchTo(m.id);
                }}
              >
                <Avatar name={m.display_name} color={m.color} src={m.avatar_data} size={24} />
                <span className="flex-1 truncate text-[12.5px]">{m.display_name}</span>
                {m.id === user?.id && <Check size={14} className="text-primary" />}
              </button>
            ))}
            <div className="my-1 border-t border-line/70" />
            <button
              className="w-full rounded-xl px-2.5 py-2 text-left text-[12px] font-medium text-primary hover:bg-primary-soft/50"
              onClick={() => { setOpen(false); navigate("/users"); }}
            >
              家庭管理…
            </button>
          </div>
        </>
      )}
      {switching && <div className="absolute inset-0 z-30 cursor-wait rounded-2xl bg-paper/60" aria-label="切换中" />}
      {!user && !switching && (
        <button className="hidden" onClick={() => showError(new Error("未找到成员"), show)} />
      )}
    </div>
  );
}

function PauseStatus() {
  const [until, setUntil] = useState<number | null>(null);
  useEffect(() => {
    const load = () => {
      void invoke<number | null>("scheduler_status").then(setUntil).catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 20_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!until || until * 1000 <= Date.now()) return null;
  const mins = Math.max(1, Math.ceil((until * 1000 - Date.now()) / 60_000));
  return (
    <div className="bg-accent-soft px-6 py-1.5 text-center text-[11px] text-accent">
      提醒已暂停，约 {mins} 分钟后恢复（托盘菜单可暂停提醒）
    </div>
  );
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

export function Shell() {
  const { switching, user } = useUser();
  const [quickOpen, setQuickOpen] = useState(false);
  const qc = useQueryClient();
  const today = new Date();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      <ReminderHost />
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-line/70 bg-gradient-to-b from-[#F4EFE6] via-[#FAF7F2] to-[#F7F3EC] px-4 pb-4 pt-5">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl shadow-[0_6px_16px_rgba(31,90,82,.22)]">
            <img src={appIcon} alt="" className="h-full w-full object-cover" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-wide text-ink">减重提醒</div>
            <div className="mt-0.5 text-[8px] font-medium tracking-[2.2px] text-muted">WEIGHT COACH</div>
          </div>
        </div>

        <UserSwitcher />

        <div className="mb-2 mt-5 px-3 text-[9px] font-medium uppercase tracking-[2px] text-muted/70">每天</div>
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors ${
                  isActive
                    ? "bg-gradient-to-r from-primary to-[#256B50] font-semibold text-white shadow-[0_8px_18px_rgba(47,125,95,.2)]"
                    : "text-[#5E6B67] hover:bg-[#EFEAE1] hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={16} className={isActive ? "text-white/90" : "text-muted"} />
                  <span>{item.label}</span>
                  {isActive && <span className="absolute right-3 h-1.5 w-1.5 rounded-full bg-gold" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mb-2 mt-4 px-3 text-[9px] font-medium uppercase tracking-[2px] text-muted/70">更多</div>
        <nav className="flex flex-col gap-0.5">
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] ${isActive ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-[#EFEAE1] hover:text-ink"}`
            }
          >
            <Settings size={15} />
            档案与目标
          </NavLink>
          <NavLink
            to="/users"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] ${isActive ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-[#EFEAE1] hover:text-ink"}`
            }
          >
            <Users size={15} />
            家庭管理
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12px] ${isActive ? "bg-primary-soft font-medium text-primary" : "text-muted hover:bg-[#EFEAE1] hover:text-ink"}`
            }
          >
            <Settings size={15} />
            设置
          </NavLink>
        </nav>

        <div className="flex-1" />
        <button
          onClick={() => setQuickOpen(true)}
          disabled={!user}
          className="mx-1 mb-3 flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-[15px] font-bold tracking-[.3px] text-white shadow-[0_10px_20px_rgba(217,119,87,.25)] transition-opacity hover:opacity-95 disabled:opacity-40"
        >
          <Plus size={17} /> 记一笔
        </button>
        <div className="flex items-center justify-between px-2 text-[9px] text-muted/70">
          <span>v0.1.0</span>
          <span>本地存储</span>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line/60 bg-paper/80 px-7 backdrop-blur">
          <div className="text-[11px] text-muted">
            {today.getFullYear()} 年 {today.getMonth() + 1} 月 {today.getDate()} 日 · 星期{weekdays[today.getDay()]}
          </div>
          <div className="flex items-center gap-1">
            <NavLink to="/settings" className="rounded-full p-2 text-muted transition-colors hover:bg-bg hover:text-ink" aria-label="设置">
              <Settings size={17} />
            </NavLink>
          </div>
        </header>
        <PauseStatus />
        <div className={`min-h-0 flex-1 overflow-auto px-7 py-6 ${switching ? "pointer-events-none opacity-60" : ""}`}>
          <div className="mx-auto w-full animate-fade-up">
            <Outlet />
          </div>
        </div>
      </main>

      {user && quickOpen && (
        <WeightModal
          userId={user.id}
          onClose={() => setQuickOpen(false)}
          onSaved={() => {
            void qc.invalidateQueries();
            window.dispatchEvent(new CustomEvent("weightcoach:refresh"));
          }}
        />
      )}
    </div>
  );
}

// 备用导出：供忘记包 Modal 的页面按需取用
export const WeightQuickEntry = ({ onSaved }: { onSaved: () => void }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const { show } = useToast();
  const { user } = useUser();
  return (
    <>
      <Button onClick={() => setOpen(true)}>记体重</Button>
      {open && (
        <Modal
          title="记体重"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={async () => {
                try {
                  const kg = Number(value);
                  if (!Number.isFinite(kg) || kg < 20 || kg > 300) throw new Error("体重须在 20–300 kg 之间");
                  const { measurementRepo } = await import("@/db/repositories");
                  if (user) await measurementRepo.save(user.id, kg);
                  setOpen(false);
                  onSaved();
                } catch (e) {
                  show(friendlyError(e), "error");
                }
              }}>保存</Button>
            </>
          }
        >
          <Field label="体重（kg）">
            <Input autoFocus type="number" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </Modal>
      )}
    </>
  );
};
