/**
 * 文本型 PDF 指标导入（SRS 9.4 / FR-REC-08/09）：
 * 选文件 → 文本层提取 + 脱敏 → <100 字符判扫描件（不发 AI）→ AI 结构化 → 逐项确认 → 只写指标。
 * 不建疾病/用药；低置信度默认不勾选；姓名未强制去除但提示用户。
 */
import { useRef, useState } from "react";
import { pdfPrompt } from "@/domain/ai";
import { PdfSchema, type PdfOutput } from "@/domain/aiSchemas";
import { Button, Card, useToast } from "@/components/ui";
import { indicatorRepo, settingsRepo, SETTINGS } from "@/db/repositories";
import { callAi } from "@/lib/aiService";
import {
  extractPdfFile, isTextlessPdf, PDF_NO_TEXT_MESSAGE,
} from "@/lib/pdfText";
import { todayStr } from "@/db/client";

interface Candidate {
  name: string;
  value: string;
  unit: string;
  measuredOn: string;
  confidence: number;
  checked: boolean;
}

export function PdfImportCard({ userId }: { userId: string }) {
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const pick = async () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    setCandidates([]);
    try {
      const extracted = await extractPdfFile(file);
      if (isTextlessPdf(extracted.text)) {
        setNotice(PDF_NO_TEXT_MESSAGE);
        return; // FR-REC-09：不发任何 AI 请求
      }
      const enabled = (await settingsRepo.get(SETTINGS.aiEnabled)) === "1";
      if (!enabled) {
        setNotice("AI 还没启用，解析体检报告需要先在设置里启用 AI。文件文字已在本机脱敏，不会发送。");
        return;
      }
      const res = await callAi<PdfOutput>({
        task: "pdf", userId,
        userPrompt: pdfPrompt(extracted.text),
        fallback: { indicators: [], diseases: [], medications: [] },
      });
      if (res.source === "local" || !res.data) {
        setNotice(res.error?.message ?? "这次没拿到解析结果，请稍后重试。");
        return;
      }
      // 用 schema 再校验一次（service 已校验，双保险）
      const parsed = PdfSchema.safeParse(res.data);
      if (!parsed.success || parsed.data.indicators.length === 0) {
        setNotice("没有从报告里识别到可确认的指标，请人工录入。");
        return;
      }
      setCandidates(parsed.data.indicators.map((i) => ({
        name: i.name,
        value: String(i.value),
        unit: i.unit,
        measuredOn: i.measured_on || todayStr(),
        confidence: i.confidence,
        checked: i.confidence >= 0.8, // 默认勾选高置信度
      })));
      if (extracted.truncated) setNotice("报告超过 20 页或 5 万字符，已截断后解析；请核对结果。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "读取 PDF 失败，请确认是文本型 PDF。");
    } finally { setBusy(false); }
  };

  const update = (idx: number, patch: Partial<Candidate>) =>
    setCandidates((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const confirm = async () => {
    const selected = candidates.filter((c) => c.checked);
    if (selected.length === 0) { show("请至少勾选一项指标", "error"); return; }
    try {
      for (const c of selected) {
        const value = Number(c.value);
        if (!Number.isFinite(value)) throw new Error(`「${c.name}」的数值无效`);
        await indicatorRepo.create(userId, {
          diseaseId: null,
          name: c.name.trim(),
          value,
          unit: c.unit.trim() || "—",
          measuredOn: c.measuredOn || todayStr(),
          note: "PDF 导入",
        });
      }
      show(`已写入 ${selected.length} 项指标`);
      setCandidates([]);
      setNotice(null);
    } catch (e) { show(e instanceof Error ? e.message : "保存失败，请重试。", "error"); }
  };

  return (
    <Card title="导入体检报告（文本型 PDF）">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          void onFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void pick()}>{busy ? "解析中…" : "选择 PDF 文件"}</Button>
        <span className="text-xs text-muted">最多 20 页 / 5 万字符；扫描件不支持；身份证号、手机号、住址、邮箱自动隐去。</span>
      </div>
      <p className="mt-2 text-xs text-amber-700">姓名不会被自动去除，发送前请自行确认报告内容。</p>

      {notice && <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</div>}

      {candidates.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-sm font-medium">确认要写入的指标（默认勾选置信度 ≥0.8 的项）</div>
          {candidates.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={c.checked} onChange={(e) => update(i, { checked: e.target.checked })} />
                <span>{c.name}</span>
              </label>
              <input aria-label="数值" className="w-20 rounded border border-border px-2 py-1" value={c.value} onChange={(e) => update(i, { value: e.target.value })} />
              <input aria-label="单位" className="w-24 rounded border border-border px-2 py-1" value={c.unit} onChange={(e) => update(i, { unit: e.target.value })} />
              <input aria-label="测量日期" type="date" className="rounded border border-border px-2 py-1" value={c.measuredOn} onChange={(e) => update(i, { measuredOn: e.target.value })} />
              <span className="text-xs text-muted">置信度 {Math.round(c.confidence * 100)}%</span>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button onClick={() => void confirm()}>确认写入指标</Button>
            <Button variant="secondary" onClick={() => setCandidates([])}>取消</Button>
          </div>
          <p className="text-xs text-muted">只写入你确认的指标；不会自动创建疾病或用药。</p>
        </div>
      )}
    </Card>
  );
}
