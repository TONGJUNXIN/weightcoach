/**
 * 饮食建议（SRS 6.10 / 6.13.1、需求分析 V0.3 表 10/11，纯函数）。
 * 只给建议，不记录三餐、不建食物库、不算饮食依从率；不出现诊断或疗效承诺。
 * 注意：此处的热量是「每日摄入目标」（FR-DIET-01），不是运动消耗；周计划与复盘页不展示热量。
 */

export interface DietTargets {
  energy: number; // 每日摄入目标 kcal
  proteinG: number;
  proteinRange: [number, number];
  fatG: number;
  fatRange: [number, number];
  carbG: number;
  carbRange: [number, number];
  fiberG: [number, number];
  sodiumMg: number;
  waterMl: [number, number];
}

/** 蛋白 1.2–1.6 g/kg 目标体重；脂肪 25–30% 能量；碳水占余量；纤维/钠/水按 V0.3 4.4。 */
export function calcDietTargets(energy: number, targetWeightKg: number): DietTargets {
  const proteinMin = Math.round(1.2 * targetWeightKg);
  const proteinMax = Math.round(1.6 * targetWeightKg);
  const proteinG = Math.round(1.4 * targetWeightKg);
  const fatMin = Math.round((energy * 0.25) / 9);
  const fatMax = Math.round((energy * 0.3) / 9);
  const fatG = Math.round((energy * 0.275) / 9);
  const carbG = Math.max(0, Math.round((energy - proteinG * 4 - fatG * 9) / 4));
  const carbMin = Math.max(0, Math.round((energy - proteinMax * 4 - fatMax * 9) / 4));
  const carbMax = Math.max(0, Math.round((energy - proteinMin * 4 - fatMin * 9) / 4));
  return {
    energy,
    proteinG,
    proteinRange: [proteinMin, proteinMax],
    fatG,
    fatRange: [fatMin, fatMax],
    carbG,
    carbRange: [carbMin, carbMax],
    fiberG: [25, 30],
    sodiumMg: 2000,
    waterMl: [1500, 2000],
  };
}

export type MealKey = "breakfast" | "lunch" | "snack" | "dinner";

export interface MealSlot {
  key: MealKey;
  name: string;
  ratio: number; // 30/35/30/5
  energy: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  example: string;
}

const MEAL_DEFS: Array<{ key: MealKey; name: string; ratio: number; example: string }> = [
  { key: "breakfast", name: "早餐", ratio: 0.3, example: "燕麦 50 g + 牛奶 250 ml + 鸡蛋 1 个 + 蓝莓一小把" },
  { key: "lunch", name: "午餐", ratio: 0.35, example: "杂粮饭 200 g + 鸡胸 150 g + 西兰花 200 g + 橄榄油 5 g" },
  { key: "snack", name: "加餐", ratio: 0.05, example: "无糖酸奶 150 g + 坚果 10 g" },
  { key: "dinner", name: "晚餐", ratio: 0.3, example: "鲈鱼 150 g + 豆腐 100 g + 时蔬 250 g + 红薯 150 g + 油 5 g" },
];

/** 3 餐 + 1 加餐，按 30/35/30/5 分配；四舍五入误差由晚餐吸收，保证合计等于目标。 */
export function mealSplit(targets: DietTargets): MealSlot[] {
  const slots: MealSlot[] = MEAL_DEFS.map((m) => ({
    ...m,
    energy: Math.round(targets.energy * m.ratio),
    proteinG: Math.round(targets.proteinG * m.ratio),
    fatG: Math.round(targets.fatG * m.ratio),
    carbG: Math.round(targets.carbG * m.ratio),
  }));
  const dinner = slots[slots.length - 1];
  if (dinner) {
    dinner.energy += targets.energy - slots.reduce((s, m) => s + m.energy, 0);
    dinner.proteinG += targets.proteinG - slots.reduce((s, m) => s + m.proteinG, 0);
    dinner.fatG += targets.fatG - slots.reduce((s, m) => s + m.fatG, 0);
    dinner.carbG += targets.carbG - slots.reduce((s, m) => s + m.carbG, 0);
  }
  return slots;
}

export interface SwapOption {
  label: string;
  portion: string;
  approxEnergy: number; // 每份约 kcal（仅用于等量替换说明）
}

export interface SwapGroup {
  category: string;
  note: string;
  options: SwapOption[];
}

/** 四类等热量替换，每类至少 4 个选项（FR-DIET-04）。 */
export const SWAP_GROUPS: SwapGroup[] = [
  {
    category: "主食",
    note: "同类等份替换，按饥饿程度与运动日调整",
    options: [
      { label: "米饭", portion: "熟重 100 g", approxEnergy: 116 },
      { label: "杂粮饭", portion: "熟重 100 g", approxEnergy: 110 },
      { label: "红薯", portion: "蒸熟 130 g", approxEnergy: 115 },
      { label: "燕麦（干）", portion: "30 g", approxEnergy: 114 },
      { label: "全麦面包", portion: "2 片约 60 g", approxEnergy: 120 },
    ],
  },
  {
    category: "蛋白",
    note: "同类等份替换，优先瘦肉、鱼虾与豆制品",
    options: [
      { label: "鸡胸肉", portion: "熟重 90 g", approxEnergy: 100 },
      { label: "鲈鱼", portion: "熟重 100 g", approxEnergy: 105 },
      { label: "虾仁", portion: "熟重 110 g", approxEnergy: 100 },
      { label: "北豆腐", portion: "200 g", approxEnergy: 100 },
      { label: "鸡蛋", portion: "2 个约 100 g", approxEnergy: 140 },
    ],
  },
  {
    category: "蔬菜",
    note: "同类等份替换，深色蔬菜占一半",
    options: [
      { label: "西兰花", portion: "200 g", approxEnergy: 70 },
      { label: "菠菜", portion: "250 g", approxEnergy: 70 },
      { label: "番茄", portion: "300 g", approxEnergy: 60 },
      { label: "黄瓜", portion: "350 g", approxEnergy: 55 },
      { label: "菌菇", portion: "250 g", approxEnergy: 65 },
    ],
  },
  {
    category: "油脂",
    note: "同类等份替换，全天烹调油建议 25–30 g",
    options: [
      { label: "橄榄油", portion: "10 g", approxEnergy: 90 },
      { label: "菜籽油", portion: "10 g", approxEnergy: 90 },
      { label: "花生油", portion: "10 g", approxEnergy: 90 },
      { label: "坚果（无盐）", portion: "15 g", approxEnergy: 90 },
      { label: "牛油果", portion: "约 60 g", approxEnergy: 95 },
    ],
  },
];

export interface DiseaseConstraint {
  presetKey: string;
  label: string;
  items: string[];
}

/** 按登记的疾病叠加约束（V0.3 表 10）；不输出诊断或疗效判断。 */
export function diseaseConstraints(
  diseases: Array<{ name: string; presetKey: string | null }>,
): DiseaseConstraint[] {
  const table: Record<string, string[]> = {
    hyperlipidemia: [
      "饱和脂肪 <7% 能量；避免反式脂肪",
      "可溶性纤维 10–15 g",
      "少内脏、肥肉、油炸",
    ],
    hypertension: [
      "钠 <2000 mg（理想 1500 mg）",
      "多蔬果、低脂奶、全谷",
      "少腌制品与外卖汤汁",
    ],
    t2dm: [
      "碳水定量，优先低 GI",
      "限制添加糖与含糖饮料",
      "使用胰岛素或磺脲类药物时避免低血糖，请遵医嘱",
    ],
    gout: [
      "限制内脏、浓肉汤、部分海鲜与啤酒",
      "足量饮水",
      "减重速度不宜过快",
    ],
    fatty_liver: [
      "严格限酒",
      "限制添加糖与果糖",
      "减重 5–10% 作为阶段目标",
    ],
    ckd: [
      "蛋白质摄入遵医嘱，不默认高蛋白",
      "限盐",
      "避免自行补钾",
    ],
    thyroid: [
      "无统一忌口",
      "左甲状腺素需空腹服用，与钙/铁/豆制品间隔",
      "具体遵医嘱",
    ],
    other: [
      "不自动套用规则，先按均衡饮食建议",
      "如有疑问请咨询医生或营养师",
    ],
  };
  return diseases.map((d) => {
    const key = d.presetKey && table[d.presetKey] ? d.presetKey : "other";
    return { presetKey: key, label: d.name, items: table[key] ?? table.other! };
  });
}

export interface ShoppingCategory {
  category: string;
  items: string[];
}

/** 购物清单（可勾选、可导出；勾选状态由页面本地维护）。 */
export function shoppingList(): ShoppingCategory[] {
  return [
    { category: "主食", items: ["燕麦", "糙米/杂粮米", "红薯", "全麦面包"] },
    { category: "蛋白", items: ["鸡胸肉", "鱼虾", "鸡蛋", "北豆腐", "无糖酸奶"] },
    { category: "蔬果", items: ["西兰花", "深色叶菜", "番茄", "黄瓜", "蓝莓/时令水果"] },
    { category: "油脂与其他", items: ["橄榄油", "无盐坚果", "低脂奶", "限盐调味料"] },
  ];
}

export const EATING_OUT_TIPS = [
  "优先蒸、煮、烤、白灼，少选油炸与红烧。",
  "主食按一拳、蛋白按一掌、蔬菜按两拳估份量。",
  "汤汁、酱料另放，蘸取而非浇淋。",
  "含糖饮料换白水或无糖茶。",
  "外食当天其余两餐按模板清淡搭配，全天总量仍按目标执行。",
] as const;

/** 饮食建议页免责声明（估算值，不承诺疗效）。 */
export const DIET_DISCLAIMER = "以上为估算值，仅供日常参考，不承诺疗效；如有疾病或用药，请遵医嘱。";
