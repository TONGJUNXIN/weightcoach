/** 表单校验纯函数（SRS 6.2/6.3/6.4、AC-04/AC-12） */
export type Check = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): Check => ({ ok: false, reason });
const ok: Check = { ok: true };

export function validateMemberName(name: string): Check {
  const n = name.trim();
  if (!n) return fail("姓名必填");
  if ([...n].length > 12) return fail("姓名不得超过 12 字");
  return ok;
}

export function validateBirthYear(year: number, today: Date = new Date()): Check {
  if (!Number.isInteger(year) || year < 1900 || year > today.getFullYear()) {
    return fail(`出生年须在 1900–${today.getFullYear()} 之间`);
  }
  return ok;
}

export function validateHeight(cm: number): Check {
  if (!Number.isFinite(cm) || cm < 100 || cm > 250) return fail("身高须在 100–250 cm 之间");
  return ok;
}

export function validateWeight(kg: number): Check {
  if (!Number.isFinite(kg) || kg < 20 || kg > 300) return fail("体重须在 20–300 kg 之间");
  return ok;
}

/** AC-12：25 cm / 250 cm 都要拒绝 */
export function validateWaist(cm: number): Check {
  if (!Number.isFinite(cm) || cm < 30 || cm > 200) return fail("腰围须在 30–200 cm 之间");
  return ok;
}

export function validateDiseaseName(name: string): Check {
  const n = name.trim();
  if (!n) return fail("疾病名称必填");
  if ([...n].length > 20) return fail("疾病名称不得超过 20 字");
  return ok;
}

export function validateIndicator(input: {
  value: number;
  unit: string;
  measuredOn: string;
}, today?: Date): Check {
  if (!Number.isFinite(input.value)) return fail("指标数值必须是有限数");
  if (!input.unit.trim() || [...input.unit.trim()].length > 8) return fail("单位必填且不得超过 8 字");
  const measured = /^\d{4}-\d{2}-\d{2}$/.test(input.measuredOn) ? new Date(`${input.measuredOn}T00:00:00`) : null;
  if (!measured || Number.isNaN(measured.getTime())) return fail("日期格式应为 YYYY-MM-DD");
  const now = today ?? new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (measured.getTime() > todayLocal.getTime()) return fail("测量日期不得晚于今天");
  return ok;
}

/** 收集所有校验错误，供表单一次性展示 */
export function firstError(...checks: Check[]): string | null {
  for (const c of checks) if (!c.ok) return c.reason;
  return null;
}
