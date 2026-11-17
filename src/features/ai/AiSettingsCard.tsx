/**
 * 设置页 AI 配置卡（SRS S13 / FR-AI-01~03/07~10）：
 * 供应商三选一、Key 存凭据管理器（仅显示末4位）、测试连接、预算、发送前预览与字段开关、历史清空。
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Eye, KeyRound, Sparkles, Wallet } from "lucide-react";
import { PROVIDERS, getProvider, type ProviderId } from "@/domain/ai";
import { Badge, Button, Card, Field, Input, Select, useToast, showError } from "@/components/ui";
import {
  aiRunRepo, aiSettingKey, getAiConfig, settingsRepo, SETTINGS,
} from "@/db/repositories";
import { currentBudget, testConnection } from "@/lib/aiService";
import type { AiConfig } from "@/db/repositories";

interface SecretStatus { configured: boolean; last4: string | null }

/** 发送数据样例（FR-AI-08）：展示将发送的字段，药名/指标随开关显隐 */
export function dataPreview(sendMeds: boolean, sendIndicators: boolean) {
  return {
    profile: { sex: "female", age: 35, heightCm: 165, activity: "light" },
    goal: { targetWeightKg: 60, dailyDeficit: 400 },
    weight: { avg: 68.5, days: 5 },
    exercise: { days: 3 },
    medication: sendMeds ? { slots: ["阿托伐他汀 10mg · 晚间"] } : { slots: "[已关闭发送药名]" },
    indicators: sendIndicators ? [{ name: "LDL-C", value: 3.1, unit: "mmol/L" }] : "[已关闭发送指标]",
  };
}

export function AiSettingsCard() {
  const { show } = useToast();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [provider, setProvider] = useState<ProviderId>("deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [budget, setBudget] = useState("5");
  const [priceIn, setPriceIn] = useState("0");
  const [priceOut, setPriceOut] = useState("0");
  const [sendMeds, setSendMeds] = useState(true);
  const [sendIndicators, setSendIndicators] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [secret, setSecret] = useState<SecretStatus>({ configured: false, last4: null });
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState(false);
  const [spent, setSpent] = useState(0);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, { baseUrl: string; model: string; priceIn: string; priceOut: string }>>({});

  const load = async () => {
    const def = getProvider(provider);
    const c = await getAiConfig(def.baseUrl, def.defaultModel, def.priceIn, def.priceOut);
    setCfg(c);
    setProvider(c.provider as ProviderId);
    setBaseUrl(c.baseUrl);
    setModel(c.model);
    setBudget(String(c.budget));
    setPriceIn(String(c.priceIn));
    setPriceOut(String(c.priceOut));
    setSendMeds(c.sendMeds);
    setSendIndicators(c.sendIndicators);
    setEnabled(c.enabled);
    const b = await currentBudget(c);
    setSpent(b.spent);
  };

  const loadSecret = async (p: ProviderId) => {
    try {
      setSecret(await invoke<SecretStatus>("secret_status", { provider: p }));
    } catch (e) { showError(e, show); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { void loadSecret(provider); }, [provider]);

  const switchProvider = (p: ProviderId) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [provider]: { baseUrl, model, priceIn, priceOut },
    }));
    setProvider(p);
    const draft = providerDrafts[p];
    const def = getProvider(p);
    setBaseUrl(draft?.baseUrl ?? def.baseUrl);
    setModel(draft?.model ?? def.defaultModel);
    setPriceIn(draft?.priceIn ?? String(def.priceIn));
    setPriceOut(draft?.priceOut ?? String(def.priceOut));
    setTestResult(null);
  };

  const save = async () => {
    try {
      await settingsRepo.set(SETTINGS.aiEnabled, enabled ? "1" : "0");
      await settingsRepo.set(SETTINGS.aiProvider, provider);
      await settingsRepo.set(aiSettingKey.baseUrl(provider), baseUrl.trim());
      await settingsRepo.set(aiSettingKey.model(provider), model.trim());
      await settingsRepo.set(SETTINGS.aiBudget, String(Number(budget) || 5));
      await settingsRepo.set(SETTINGS.aiPriceIn, String(Number(priceIn) || 0));
      await settingsRepo.set(SETTINGS.aiPriceOut, String(Number(priceOut) || 0));
      await settingsRepo.set(SETTINGS.aiSendMeds, sendMeds ? "1" : "0");
      await settingsRepo.set(SETTINGS.aiSendIndicators, sendIndicators ? "1" : "0");
      await settingsRepo.set(SETTINGS.aiPreviewShown, "1");
      show("AI 设置已保存");
    } catch (e) { showError(e, show); }
  };

  const saveKey = async () => {
    const k = keyInput.trim();
    if (!k) { show("请先填写密钥", "error"); return; }
    try {
      await invoke("secret_set", { provider, key: k });
      setKeyInput("");
      await loadSecret(provider);
      show("密钥已保存到 Windows 凭据管理器");
    } catch (e) { showError(e, show); }
  };

  const deleteKey = async () => {
    try {
      await invoke("secret_delete", { provider });
      await loadSecret(provider);
      show("密钥已删除");
    } catch (e) { showError(e, show); }
  };

  const doTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testConnection(provider, baseUrl.trim(), model.trim());
      setTestResult({ ok: r.ok, text: `${r.message} · 延迟 ${r.latencyMs} ms` });
    } catch (e) { showError(e, show); }
    finally { setTesting(false); }
  };

  const clearHistory = async () => {
    if (!window.confirm("删除本机全部 AI 调用记录？此操作不可撤销。")) return;
    try {
      await aiRunRepo.clearAll();
      await load();
      show("AI 调用记录已清空");
    } catch (e) { showError(e, show); }
  };

  const def = getProvider(provider);
  const pct = cfg ? Math.min(100, Math.round((spent / Math.max(0.01, cfg.budget)) * 100)) : 0;

  return (
    <Card
      title="AI 服务（可选，本地优先）"
      eyebrow="AI SETTINGS"
      action={<Badge tone={enabled ? "teal" : "muted"}>{enabled ? "已启用" : "未启用"}</Badge>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr]">
          <Field label="服务商" hint="Key 分别保存，切换不串 Key">
            <Select value={provider} onChange={(e) => switchProvider(e.target.value as ProviderId)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="启用 AI" hint="关闭后全部走本地规则">
            <Select value={enabled ? "1" : "0"} onChange={(e) => setEnabled(e.target.value === "1")}>
              <option value="0">关闭</option><option value="1">开启</option>
            </Select>
          </Field>
          <Field label="测试连接" hint="只验证配置，不保存">
            <Button variant="secondary" className="w-full" disabled={testing} onClick={() => void doTest()}>
              {testing ? "测试中…" : "发送测试请求"}
            </Button>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Base URL"><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={def.baseUrl} /></Field>
          <Field label="模型" hint={def.modelHint}><Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={def.defaultModel || def.modelHint} /></Field>
        </div>

        <div className="rounded-2xl border border-line/70 bg-bg/50 p-3.5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-ink"><KeyRound size={13} className="text-primary" /> API Key</div>
          <div className="flex flex-wrap gap-2">
            <Input
              type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
              placeholder={secret.configured ? `已配置（末四位 ${secret.last4 ?? ""}）` : "从未配置"}
              className="min-w-[220px] flex-1"
            />
            <Button variant="secondary" onClick={() => void saveKey()}>保存密钥</Button>
            {secret.configured && <Button variant="danger" onClick={() => void deleteKey()}>删除</Button>}
            <Badge tone={secret.configured ? "teal" : "muted"}>{secret.configured ? "已保存到凭据管理器" : "未配置"}</Badge>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">来源：{def.keySource} · 数据库、日志与导出包均不含明文。</p>
        </div>

        {testResult && (
          <div className={`rounded-xl px-3 py-2 text-[11px] ${testResult.ok ? "bg-primary-soft text-primary-deep" : "bg-accent-soft text-accent"}`}>
            {testResult.ok ? "连接成功" : "连接失败"} · {testResult.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr]">
          <Field label="月预算（元）" hint="默认 5 元；80% 提示，100% 停自动">
            <Input type="number" min="0" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label="输入价（元/千 token）" hint="按服务商账单调整">
            <Input type="number" min="0" step="0.0001" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} />
          </Field>
          <Field label="输出价（元/千 token）" hint="只用于本地估算">
            <Input type="number" min="0" step="0.0001" value={priceOut} onChange={(e) => setPriceOut(e.target.value)} />
          </Field>
          <Field label="发送范围" hint="药名 / 指标可单独关闭">
            <div className="flex gap-2">
              <Button variant={sendMeds ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setSendMeds((v) => !v)}>
                药名 {sendMeds ? "开" : "关"}
              </Button>
              <Button variant={sendIndicators ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setSendIndicators((v) => !v)}>
                指标 {sendIndicators ? "开" : "关"}
              </Button>
            </div>
          </Field>
        </div>

        <div className="rounded-2xl border border-line/70 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink"><Wallet size={13} className="text-primary" /> 本月用量</div>
            <span className="tabular text-[11px] text-muted">¥{spent.toFixed(3)} / ¥{cfg?.budget ?? 5}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line/60">
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-gold" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[9px] text-muted">按 token 估算，不替代供应商账单；80% 提示，100% 暂停自动任务。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPreview((v) => !v)}><Eye size={13} /> {preview ? "收起预览" : "预览发送的数据"}</Button>
          <Button variant="secondary" onClick={() => void clearHistory()}>清空 AI 历史</Button>
          <Button onClick={() => void save()}><Sparkles size={13} /> 保存 AI 设置</Button>
        </div>
        {preview && (
          <pre className="max-h-56 overflow-auto rounded-xl bg-bg p-3 text-[10px] leading-relaxed text-muted">
            {JSON.stringify(dataPreview(sendMeds, sendIndicators), null, 2)}
          </pre>
        )}
        <p className="text-[9px] leading-relaxed text-muted">首次启用会展示发送数据样例；发送到第三方前请确认。AI 失败只在模块内显示状态条，不弹错误框。</p>
      </div>
    </Card>
  );
}
