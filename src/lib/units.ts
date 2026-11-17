/** 单位显示换算（FR-SET-07）：数据库始终存 kg/cm，只在显示层换算。 */
export type UnitSystem = "metric" | "imperial";

export function formatWeight(kg: number, unit: UnitSystem): string {
  return unit === "imperial" ? `${(kg * 2.2046226218).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

export function formatLength(cm: number, unit: UnitSystem): string {
  return unit === "imperial" ? `${(cm / 2.54).toFixed(1)} in` : `${cm.toFixed(1)} cm`;
}
