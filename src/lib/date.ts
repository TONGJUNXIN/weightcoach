/** 本地日期工具（SRS 3.5：只用本地 YYYY-MM-DD，周一起点）。 */

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** 周一（含当天若是周一）；weekday 0=周一 */
export function mondayStart(d: Date): Date {
  const wd = (d.getDay() + 6) % 7;
  return addDays(d, -wd);
}

/** 范围起点：days 天前；"all" 返回 null 表示不限 */
export function rangeFrom(days: number | "all"): string | null {
  if (days === "all") return null;
  return fmtDate(addDays(new Date(), -(days - 1)));
}

/** 上周区间 [周一, 周日] */
export function lastWeekRange(now = new Date()): { from: string; to: string; monday: string } {
  const thisMon = mondayStart(now);
  const lastMon = addDays(thisMon, -7);
  const lastSun = addDays(lastMon, 6);
  return { from: fmtDate(lastMon), to: fmtDate(lastSun), monday: fmtDate(lastMon) };
}

/** 前一周区间 */
export function prevWeekRange(now = new Date()): { from: string; to: string } {
  const thisMon = mondayStart(now);
  const prevMon = addDays(thisMon, -14);
  const prevSun = addDays(prevMon, 6);
  return { from: fmtDate(prevMon), to: fmtDate(prevSun) };
}

/** 4 周前区间（腰围 4 周对比用） */
export function fourWeeksAgoRange(now = new Date()): { from: string; to: string } {
  const thisMon = mondayStart(now);
  const fourMon = addDays(thisMon, -28);
  const fourSun = addDays(fourMon, 6);
  return { from: fmtDate(fourMon), to: fmtDate(fourSun) };
}

/** 周报标题：2026-11-10 ~ 2026-11-16 */
export function weekLabel(from: string, to: string): string {
  return `${from} ~ ${to}`;
}
