/** 与 src-tauri/migrations/001_init.sql 一一对应的行类型 */
export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active";

export interface UserRow {
  id: string;
  display_name: string;
  color: string;
  avatar_data: string | null;
  is_owner: number;
  archived_at: string | null;
  created_at: string;
}

export interface ProfileRow {
  user_id: string;
  sex: Sex;
  birth_year: number;
  height_cm: number;
  activity_level: ActivityLevel;
  waist_baseline_cm: number | null;
  constraints_json: string; // ["knee" | "waist" | "cardio"]
  city_id: string | null;
  city_name: string | null;
  updated_at: string;
}

export interface GoalRow {
  id: string;
  user_id: string;
  target_weight_kg: number;
  daily_deficit_kcal: number;
  target_date: string | null;
  protein_target_g: number | null;
  active: number;
  created_at: string;
}

export interface DiseaseRow {
  id: string;
  user_id: string;
  name: string;
  preset_key: string | null;
  status: "active" | "remission";
  diagnosed_on: string | null;
  note: string | null;
  created_at: string;
}

export interface IndicatorRow {
  id: string;
  user_id: string;
  disease_id: string | null;
  name: string;
  value: number;
  unit: string;
  measured_on: string;
  note: string | null;
  created_at: string;
}

export interface MemberSummary {
  user: UserRow;
  weightKg: number | null;
  hasMeasurementToday: boolean;
  hasExerciseToday: boolean;
}

/** 创建户主 / 添加成员的一次性表单数据（FR-USR-01/03） */
export interface MemberInput {
  displayName: string;
  color?: string;
  avatar?: string | null;
  sex: Sex;
  birthYear: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  weightKg: number;
  targetWeightKg: number;
  targetDate?: string | null;
  dailyDeficitKcal?: number;
  cityId?: string | null;
  cityName?: string | null;
  waistBaselineCm?: number | null;
  constraints?: string[];
}

export interface MemberEdit extends Partial<MemberInput> {
  archivedAt?: string | null;
  avatar?: string | null;
  /** 每日缺口（350–500）；编辑目标时保留用户设置，不再硬编码 400 */
  dailyDeficitKcal?: number;
  /** 自设达成日期；推荐方案传 null */
  targetDate?: string | null;
}

/** S2：记录 / 用药与打卡 */
export type MedStatus = "taken" | "skipped" | "missed";

export interface MeasurementRow {
  id: string;
  user_id: string;
  measured_on: string;
  weight_kg: number;
  waist_cm: number | null;
  note: string | null;
  created_at: string;
}

export interface ExerciseLogRow {
  id: string;
  user_id: string;
  logged_on: string;
  did_exercise: number; // 0/1
  note: string | null;
  created_at: string;
}

export interface MedicationRow {
  id: string;
  user_id: string;
  disease_id: string | null;
  name: string;
  dose: number;
  dose_unit: string;
  start_on: string | null;
  end_on: string | null;
  active: number;
  created_at: string;
}

export interface MedicationSlotRow {
  id: string;
  medication_id: string;
  time_of_day: string; // HH:MM
  label: string | null;
}

export interface MedicationLogRow {
  id: string;
  slot_id: string;
  log_date: string;
  status: MedStatus;
  taken_at: string | null;
}

/** 今日用药打卡项：时段 + 药物信息 + 当日状态（JOIN 结果） */
export interface MedDueItem {
  slot_id: string;
  medication_id: string;
  time_of_day: string;
  label: string | null;
  name: string;
  dose: number;
  dose_unit: string;
  disease_id: string | null;
  status: MedStatus | null;
}

/** 打卡输入 */
export interface MedInput {
  name: string;
  dose: number;
  doseUnit: string;
  startOn: string | null;
  endOn: string | null;
  diseaseId: string | null;
  times: string[]; // HH:MM
}

/** S3：事件标记 / 周报追溯 / 导出 */
export interface EventMarkerRow {
  id: string;
  user_id: string;
  event_date: string;
  type: string;
  label: string;
}

export interface WeeklyPlanRow {
  id: string;
  user_id: string;
  week_start: string;
  status: string;
  summary_json: string | null;
  created_at: string;
}

export interface PlanItemRow {
  id: string;
  plan_id: string;
  plan_date: string;
  mode: string;
  minutes: number;
  intensity: string;
  place: string;
  reason: string | null;
  status: string;
  sort_order: number;
}

/** S4：天气缓存（60 分钟 TTL，失败降级用） */
export interface WeatherCacheRow {
  city_id: string;
  forecast_date: string;
  payload_json: string;
  fetched_at: string;
}

/** 趋势图数据点 */
export interface WeightPoint {
  date: string;
  weight: number;
  ma7: number | null;
  target: number | null;
  events: string[];
}

export interface WaistPoint {
  date: string;
  waist: number;
}

/** 导出包（SRS 8.3）：不含 Key / ai_runs / weather_cache / 日志 */
export interface ExportBundle {
  schemaVersion: number;
  exportedAt: string;
  users: unknown[];
  profiles: unknown[];
  goals: unknown[];
  measurements: unknown[];
  exerciseLogs: unknown[];
  diseases: unknown[];
  indicators: unknown[];
  medications: unknown[];
  medicationSlots: unknown[];
  medicationLogs: unknown[];
  weeklyPlans: unknown[];
  planItems: unknown[];
  eventMarkers: unknown[];
}
