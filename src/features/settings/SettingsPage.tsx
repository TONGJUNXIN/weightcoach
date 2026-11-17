import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { CloudSun, Database, Info, Monitor, Save, ShieldCheck } from "lucide-react";
import {
  Badge, Button, Card, Field, Input, Modal, PageHeader, showError, useToast,
} from "@/components/ui";
import { exportRepo, settingsRepo, SETTINGS } from "@/db/repositories";
import type { ExportBundle } from "@/db/types";
import { fmtDate } from "@/lib/date";
import { AiSettingsCard } from "@/features/ai/AiSettingsCard";

const keys = [
  { key: SETTINGS.autostart, label: "开机自动启动", hint: "登录 Windows 后自动打开" },
  { key: SETTINGS.reminderWeight, label: "体重提醒（早间）", hint: "起床后提醒称重" },
  { key: SETTINGS.reminderMed, label: "用药提醒（21:00）", hint: "晚间按登记时段提醒" },
  { key: SETTINGS.reminderReview, label: "周复盘提醒（周一）", hint: "周一提醒回看上一周" },
];

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 设置页（S13 / SRS 6.12）：提醒、外观、单位、导出/备份/恢复、关于。 */
export function SettingsPage() {
  const { show } = useToast();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dataDir, setDataDir] = useState("");
  const { data, refetch } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const result: Record<string, string> = {};
      for (const { key } of keys) result[key] = (await settingsRepo.get(key)) ?? "1";
      result[SETTINGS.fontSize] = (await settingsRepo.get(SETTINGS.fontSize)) ?? "normal";
      result[SETTINGS.weatherKey] = (await settingsRepo.get(SETTINGS.weatherKey)) ?? "";
      return result;
    },
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (key: string) => draft[key] ?? data?.[key] ?? (key === SETTINGS.weatherKey ? "" : "1");

  const update = async (key: string, val: string) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
    if (key === SETTINGS.fontSize) {
      const px = Math.min(18, Math.max(13, Number(val) || 15));
      document.documentElement.style.fontSize = `${px}px`;
      document.documentElement.style.setProperty("--ui-scale", String(px / 15));
      document.documentElement.dataset.fontScale = px >= 17 ? "large" : "";
    }
  };

  const fontValue = value(SETTINGS.fontSize);
  const fontPx = fontValue === "large" ? 17 : fontValue === "normal" || !fontValue ? 15 : Number(fontValue) || 15;

  const save = async () => {
    setSaving(true);
    try {
      for (const [key, val] of Object.entries(draft)) await settingsRepo.set(key, val);
      if (draft[SETTINGS.autostart] !== undefined) await invoke("set_autostart", { enabled: draft[SETTINGS.autostart] === "1" });
      await refetch();
      setDraft({});
      show("设置已保存");
    } catch (e) { showError(e, show); }
    finally { setSaving(false); }
  };

  const exportJson = async () => {
    setBusy(true);
    try {
      const bundle = await exportRepo.bundle();
      const path = await saveDialog({ defaultPath: `weightcoach-backup-${fmtDate(new Date())}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!path) return;
      await invoke("write_text_file", { path, content: JSON.stringify(bundle, null, 2) });
      show("JSON 备份已导出（不含密钥与 AI 日志）");
    } catch (e) { showError(e, show); }
    finally { setBusy(false); }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (!dir) return;
      let count = 0;
      for (const table of exportRepo.csvTables()) {
        const rows = await table.rows();
        const cols = rows.length ? Object.keys(rows[0] as Record<string, unknown>) : [];
        const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape((r as Record<string, unknown>)[c])).join(","))].join("\n");
        await invoke("write_text_file", { path: `${dir}/weightcoach-${table.name}.csv`, content: csv });
        count++;
      }
      show(`已导出 ${count} 个 CSV 分表`);
    } catch (e) { showError(e, show); }
    finally { setBusy(false); }
  };

  const manualBackup = async () => {
    setBusy(true);
    try {
      const path = await invoke<string>("auto_backup");
      show(`备份已创建：${path}`);
    } catch (e) { showError(e, show); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const path = await openDialog({ filters: [{ name: "JSON 备份", extensions: ["json"] }], multiple: false });
      if (!path) return;
      if (!window.confirm("恢复将清空当前全部数据并用备份替换，且不可撤销。确认继续？")) return;
      const raw = await invoke<string>("read_text_file", { path });
      const bundle = JSON.parse(raw) as ExportBundle;
      await exportRepo.restore(bundle);
      show("恢复完成，数据已一致");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { showError(e, show); }
    finally { setBusy(false); }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await exportRepo.clearAll();
      setConfirmClear(false);
      show("全部数据已清空，即将进入首次引导");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { showError(e, show); }
    finally { setBusy(false); }
  };

  const openDir = async () => {
    try {
      const dir = await invoke<string>("data_dir");
      setDataDir(dir);
      await invoke("open_data_dir");
    } catch (e) { showError(e, show); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="SETTINGS"
        title="设置"
        subtitle="全局设置对所有成员生效；数据库始终以 kg/cm 存储。"
        actions={<Button disabled={saving} onClick={() => void save()}><Save size={14} /> {saving ? "保存中…" : "保存设置"}</Button>}
      />

      <div className="grid grid-cols-1 gap-4 min-[1050px]:grid-cols-2">
        <Card title="提醒与启动" eyebrow="REMINDERS" action={<Badge tone="muted">23:00–06:00 免打扰</Badge>}>
          <div className="divide-y divide-line/60">
            {keys.map(({ key, label, hint }) => (
              <div key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="text-[12px] font-medium text-ink">{label}</div>
                  <div className="mt-0.5 text-[10px] text-muted">{hint}</div>
                </div>
                <Toggle checked={value(key) === "1"} onChange={(v) => void update(key, v ? "1" : "0")} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-muted">期间不弹任何提醒；不提供久坐/饮水等额外提醒。</p>
        </Card>

        <Card title="外观与单位" eyebrow="APPEARANCE" action={<Monitor size={15} className="text-muted" />}>
          <Field label="界面字号" hint="拖动滑轨立即预览，13–18 px；保存后下次启动保持">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted">小</span>
              <input
                type="range"
                min={13}
                max={18}
                step={1}
                value={fontPx}
                onChange={(e) => void update(SETTINGS.fontSize, e.target.value)}
                className="h-1.5 flex-1 cursor-pointer accent-[#2F7D5F]"
                aria-label="界面字号"
              />
              <span className="text-[10px] text-muted">大</span>
              <span className="tabular w-10 text-right text-[11px] font-medium text-ink">{fontPx}px</span>
            </div>
          </Field>
          <Field label="显示单位" hint="本期固定公制；数据库始终存 kg/cm，避免历史数据误读">
            <Input value="kg / cm" readOnly className="bg-bg/60" />
          </Field>
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-bg px-3 py-2.5 text-[10px] leading-relaxed text-muted">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-primary" />
            <span>本期只有浅色主题与中文；单位换算只影响展示，不改写历史数据。</span>
          </div>
        </Card>

        <Card title="天气服务（可选）" eyebrow="WEATHER" action={<CloudSun size={15} className="text-muted" />}>
          <Field label="和风天气 Key（可留空）" hint="留空时自动使用 Open-Meteo；Key 只保存在本机，不随备份导出">
            <Input
              type="password"
              autoComplete="off"
              placeholder="留空使用 Open-Meteo"
              value={value(SETTINGS.weatherKey)}
              onChange={(e) => void update(SETTINGS.weatherKey, e.target.value)}
            />
          </Field>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            城市搜索与天气需联网；失败时使用最近缓存或按室内安排，不影响记录、提醒、趋势与饮食建议。
          </p>
        </Card>

        <Card title="关于与隐私" eyebrow="ABOUT" action={<Info size={15} className="text-muted" />}>
          <div className="space-y-2 text-[11px] leading-relaxed text-muted">
            <p className="font-medium text-ink">减重提醒 v0.1.0 · S5</p>
            <p>只做记录、提醒与生活方式建议，不做诊断、用药或医疗建议。</p>
            <p>不收集遥测、不自动上传、不接广告。AI 与天气需主动启用。</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => void openDir()}>打开数据目录</Button>
              {dataDir && <code className="max-w-full truncate rounded bg-bg px-2 py-1 text-[9px]">{dataDir}</code>}
            </div>
          </div>
        </Card>
      </div>

      <AiSettingsCard />

      <Card title="数据导出 / 备份 / 恢复" eyebrow="DATA" action={<Database size={15} className="text-muted" />}>
        <div className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-4">
          <Button disabled={busy} onClick={() => void exportJson()}>导出 JSON（全量）</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void exportCsv()}>导出 CSV（分表）</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void manualBackup()}>立即备份</Button>
          <Button disabled={busy} variant="secondary" onClick={() => void restore()}>从备份恢复</Button>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-muted">
          每日启动自动备份，保留最近 7 份。导出包含 schema 版本，不含密钥、AI 调用记录、天气缓存与日志。恢复与清空均需二次确认。
        </p>
        <div className="mt-4 border-t border-line/60 pt-3">
          <Button variant="danger" size="sm" onClick={() => setConfirmClear(true)}>清空全部数据</Button>
        </div>
      </Card>

      {confirmClear && (
        <Modal title="清空全部数据" onClose={() => setConfirmClear(false)} footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => void clearAll()}>确认清空</Button>
          </>
        }>
          <p className="text-sm leading-relaxed text-danger">将删除所有成员及其体重、运动、用药、指标、计划、事件标记等记录，且不可恢复。请先导出备份。</p>
        </Modal>
      )}
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
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
