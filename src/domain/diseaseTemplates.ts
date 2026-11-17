/** 预置疾病与默认指标模板（FR-DIS-01/03，AC-06） */
export interface IndicatorTemplate {
  name: string;
  unit: string;
}

export interface DiseasePreset {
  key: string;
  label: string;
  indicators: IndicatorTemplate[];
}

export const DISEASE_PRESETS: DiseasePreset[] = [
  { key: "hyperlipidemia", label: "高血脂", indicators: [
    { name: "TC", unit: "mmol/L" }, { name: "TG", unit: "mmol/L" },
    { name: "LDL", unit: "mmol/L" }, { name: "HDL", unit: "mmol/L" },
  ] },
  { key: "hypertension", label: "高血压", indicators: [
    { name: "收缩压", unit: "mmHg" }, { name: "舒张压", unit: "mmHg" },
  ] },
  { key: "t2dm", label: "2 型糖尿病", indicators: [
    { name: "空腹血糖", unit: "mmol/L" }, { name: "糖化血红蛋白", unit: "%" },
  ] },
  { key: "fatty_liver", label: "脂肪肝", indicators: [
    { name: "ALT", unit: "U/L" }, { name: "AST", unit: "U/L" },
  ] },
  { key: "gout", label: "高尿酸/痛风", indicators: [
    { name: "血尿酸", unit: "μmol/L" },
  ] },
  { key: "thyroid", label: "甲状腺疾病", indicators: [
    { name: "TSH", unit: "mIU/L" }, { name: "FT4", unit: "pmol/L" },
  ] },
  { key: "ckd", label: "慢性肾病", indicators: [
    { name: "肌酐", unit: "μmol/L" }, { name: "eGFR", unit: "mL/min" },
  ] },
  { key: "other", label: "其他", indicators: [] },
];

export function findPreset(key: string): DiseasePreset | undefined {
  return DISEASE_PRESETS.find((p) => p.key === key);
}
