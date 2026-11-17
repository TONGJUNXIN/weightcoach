import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, LogIn, Pencil, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { Avatar, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, showError, useToast } from "@/components/ui";
import { userRepo } from "@/db/repositories";
import type { UserRow } from "@/db/types";
import { useUser } from "@/app/UserContext";
import { EMPTY_DRAFT, fromMember, MemberForm, validateGoalStep, validateProfileStep, withGoalPlan, type MemberDraft } from "./MemberForm";
import { profileRepo, goalRepo, measurementRepo } from "@/db/repositories";

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; user: UserRow }
  | { kind: "delete"; user: UserRow }
  | null;

export function UsersPage() {
  const { user, refresh, switchTo } = useUser();
  const qc = useQueryClient();
  const { show } = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState<MemberDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [relatedCount, setRelatedCount] = useState<number | null>(null);
  const { data: members = [], refetch } = useQuery({ queryKey: ["users"], queryFn: () => userRepo.listAll() });

  const openAdd = () => { setDraft(EMPTY_DRAFT); setError(null); setDialog({ kind: "add" }); };
  const openEdit = async (target: UserRow) => {
    try {
      const [profile, goal, measurement] = await Promise.all([
        profileRepo.get(target.id), goalRepo.get(target.id), measurementRepo.latest(target.id),
      ]);
      const weight = measurement?.weight_kg ?? 70;
      // 兼容旧数据/中断添加留下的“只有 users 行”的成员：缺档案或目标也能打开并修好
      const safeProfile = profile ?? {
        sex: "male" as const,
        birth_year: 1990,
        height_cm: 170,
        activity_level: "light" as const,
        waist_baseline_cm: null,
        city_id: "39.9042,116.4074",
        city_name: "北京",
        constraints_json: "[]",
      };
      const safeGoal = goal ?? {
        target_weight_kg: Math.max(20, weight - 5),
        daily_deficit_kcal: 400,
        target_date: null,
      };
      setDraft(fromMember(target, safeProfile, safeGoal, weight));
      setError(null);
      setDialog({ kind: "edit", user: target });
    } catch (e) { showError(e, show); }
  };
  const openDelete = async (target: UserRow) => {
    if (!user) return;
    try {
      const n = await userRepo.countRelated(user.id, target.id);
      setRelatedCount(n);
      setConfirmName("");
      setDialog({ kind: "delete", user: target });
    } catch (e) { showError(e, show); }
  };

  const saveMember = async () => {
    if (!user) return;
    const message = validateProfileStep(draft) ?? validateGoalStep(draft);
    if (message) { setError(message); return; }
    const normalized = withGoalPlan(draft);
    try {
      if (dialog?.kind === "add") {
        // addMember 已在事务内写入 active_user_id；这里直接 refresh，
        // 避免再走一次 switch 造成“成员已写入但提示失败”。
        await userRepo.addMember(user.id, normalized);
        qc.clear();
        await refresh();
      } else if (dialog?.kind === "edit") {
        await userRepo.updateMember(user.id, dialog.user.id, normalized);
        await refresh();
      }
      await refetch();
      setDialog(null);
      show(dialog?.kind === "add" ? "成员已添加并切换" : "成员信息已更新");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(`保存失败：${detail}`);
      showError(e, show);
    }
  };

  const removeMember = async () => {
    if (!user || dialog?.kind !== "delete") return;
    if (confirmName.trim() !== dialog.user.display_name) {
      setError("请输入与成员姓名完全一致的名称");
      return;
    }
    try {
      await userRepo.remove(user.id, dialog.user.id);
      const remaining = members.filter((m) => m.id !== dialog.user.id);
      await refetch();
      await refresh();
      setDialog(null);
      if (remaining.length === 0) {
        show("成员已删除，即将回到首次引导");
        setTimeout(() => window.location.reload(), 700);
      } else {
        show("成员已删除");
      }
    } catch (e) { showError(e, show); }
  };

  const archive = async (target: UserRow, archived: boolean) => {
    if (!user) return;
    try {
      await userRepo.archive(user.id, target.id, archived);
      await refetch();
      show(archived ? "已归档，数据保留" : "已恢复成员");
    } catch (e) { showError(e, show); }
  };

  const archivedCount = members.filter((m) => !!m.archived_at).length;
  const activeCount = members.filter((m) => !m.archived_at).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="FAMILY"
        title="家庭管理"
        subtitle="添加、编辑、归档或删除成员；户主也可删除，删除当前成员会自动切换。"
      />

      <div className="-mt-2 flex justify-start">
        <Button onClick={openAdd}><UserPlus size={15} /> 添加成员</Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
          <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">全部成员</div>
          <div className="mt-2 flex items-baseline gap-1"><span className="tabular text-[24px] font-semibold text-ink">{members.length}</span><span className="text-[10px] text-muted">人</span></div>
        </div>
        <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
          <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">使用中</div>
          <div className="mt-2 flex items-baseline gap-1"><span className="tabular text-[24px] font-semibold text-primary">{activeCount}</span><span className="text-[10px] text-muted">人</span></div>
        </div>
        <div className="rounded-2xl border border-line/80 bg-paper p-4 shadow-soft">
          <div className="text-[9px] font-medium uppercase tracking-[1.8px] text-muted">已归档</div>
          <div className="mt-2 flex items-baseline gap-1"><span className="tabular text-[24px] font-semibold text-muted">{archivedCount}</span><span className="text-[10px] text-muted">人</span></div>
        </div>
      </div>

      <Card title={`成员（${members.length}）`} eyebrow="MEMBERS" action={<Users size={15} className="text-muted" />}>
        {members.length === 0 ? <Empty text="暂无成员" /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {members.map((m) => {
              const current = m.id === user?.id;
              const archived = !!m.archived_at;
              return (
                <div
                  key={m.id}
                  className={`rounded-2xl border p-4 transition-colors ${
                    current ? "border-primary/40 bg-primary-soft/35" : archived ? "border-line/60 bg-bg/40" : "border-line/80 bg-paper"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={m.display_name} color={m.color} src={m.avatar_data} size={44} className="rounded-2xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-ink">{m.display_name}</span>
                        {m.is_owner === 1 && <Badge tone="gold">户主</Badge>}
                        {current && <Badge tone="teal">当前</Badge>}
                        {archived && <Badge tone="muted">已归档</Badge>}
                      </div>
                      <div className="mt-1 text-[10px] text-muted">
                        {archived ? "数据保留，可恢复" : current ? "正在使用这个档案" : "可切换查看"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line/50 pt-2.5">
                    {!archived && !current && (
                      <Button variant="secondary" size="sm" onClick={() => void switchTo(m.id)}><LogIn size={12} /> 切换</Button>
                    )}
                    {!archived && <Button variant="ghost" size="sm" onClick={() => void openEdit(m)}><Pencil size={12} /> 编辑</Button>}
                    {m.is_owner === 0 && (
                      archived
                        ? <Button variant="ghost" size="sm" onClick={() => void archive(m, false)}><RotateCcw size={12} /> 恢复</Button>
                        : <Button variant="ghost" size="sm" onClick={() => void archive(m, true)}><Archive size={12} /> 归档</Button>
                    )}
                    <Button variant="ghost" size="sm" className="ml-auto text-danger" onClick={() => void openDelete(m)}><Trash2 size={12} /> 删除</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {(dialog?.kind === "add" || dialog?.kind === "edit") && (
        <Modal
          title={dialog.kind === "add" ? "添加成员" : `编辑 ${dialog.user.display_name}`}
          width="xl"
          dismissable={false}
          onClose={() => setDialog(null)}
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button onClick={() => void saveMember()}>保存</Button></>}
        >
          {error && <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-[11px] text-accent">{error}</p>}
          <MemberForm draft={draft} step="full" onChange={(patch) => setDraft({ ...draft, ...patch })} />
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal
          title="删除成员"
          onClose={() => setDialog(null)}
          footer={<><Button variant="secondary" onClick={() => setDialog(null)}>取消</Button><Button variant="danger" onClick={() => void removeMember()}>确认删除</Button></>}
        >
          <p className="text-[12px] leading-relaxed text-danger">此操作不可恢复。将删除「{dialog.user.display_name}」的全部业务数据（约 {relatedCount ?? "…"} 条记录）与 AI 历史。</p>
          <Field label="请输入成员姓名以确认">
            <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={dialog.user.display_name} />
          </Field>
          {error && <p className="text-[11px] text-danger">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
