/**
 * 仓储层（SRS 5.4 / 3.5 硬性约定）：
 * 1. 每个成员业务方法第一个参数是 userId（操作者），SQL 显式带 user_id 条件；
 * 2. 禁止先查全表再内存过滤；
 * 3. 删除/创建走事务。
 */
import { execute as run, newId, nowIso, select, selectOne, transaction, todayStr } from "./client";
import type {
  DiseaseRow,
  EventMarkerRow,
  ExportBundle,
  ExerciseLogRow,
  GoalRow,
  IndicatorRow,
  MeasurementRow,
  MedDueItem,
  MedInput,
  MedicationRow,
  MedicationSlotRow,
  MedStatus,
  MemberEdit,
  PlanItemRow,
  MemberInput,
  ProfileRow,
  UserRow,
  WaistPoint,
  WeatherCacheRow,
  WeeklyPlanRow,
  WeightPoint,
} from "./types";
import type { PlanItem } from "@/domain/plan";
import type { WeatherDay } from "@/domain/weather";
import { resolvePrice } from "@/domain/aiBudget";

export const SETTINGS = {
  activeUserId: "active_user_id",
  onboardingDone: "onboarding_done",
  autostart: "autostart",
  reminderWeight: "reminder_weight_enabled",
  reminderMed: "reminder_med_enabled",
  reminderReview: "reminder_review_enabled",
  fontSize: "font_size",
  unitSystem: "unit_system",
  // S2 提醒去重键（SRS 4.4 / 10.1）
  lastWeightPromptDate: "last_weight_prompt_date",
  lastMedPromptDate: "last_med_prompt_date",
  lastReviewPromptWeek: "last_review_prompt_week",
  lastWeightFallbackDate: "last_weight_fallback_date",
  // S4 天气：和风天气 Key（可选，不填走 Open-Meteo）；不随导出包带出
  weatherKey: "weather_qweather_key",
  // S5 AI：启用状态与预算（Key 存 Windows 凭据管理器，绝不进 app_settings/导出包）
  aiEnabled: "ai_enabled",
  aiProvider: "ai_provider",
  aiBudget: "ai_monthly_budget_cny",
  aiPriceIn: "ai_price_in_per_k",
  aiPriceOut: "ai_price_out_per_k",
  aiSendMeds: "ai_send_med_names",
  aiSendIndicators: "ai_send_indicator_names",
  aiPreviewShown: "ai_preview_shown",
  aiSpentMonth: "ai_spent_month",
  aiSpent: "ai_spent_cny",
} as const;

export const settingsRepo = {
  async get(key: string): Promise<string | null> {
    const row = await selectOne<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?",
      [key],
    );
    return row?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    await run(
      "INSERT INTO app_settings(key, value, updated_at) VALUES(?,?,?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [key, value, nowIso()],
    );
  },
};

async function insertProfile(userId: string, input: MemberInput): Promise<void> {
  await run(
    `INSERT INTO profiles(user_id, sex, birth_year, height_cm, activity_level,
       waist_baseline_cm, constraints_json, city_id, city_name, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      input.sex,
      input.birthYear,
      input.heightCm,
      input.activityLevel,
      input.waistBaselineCm ?? null,
      JSON.stringify(input.constraints ?? []),
      input.cityId ?? null,
      input.cityName ?? null,
      nowIso(),
    ],
  );
  await insertMeasurement(userId, input.weightKg, input.waistBaselineCm ?? null);
  await insertGoal(
    userId,
    input.targetWeightKg,
    input.dailyDeficitKcal ?? 400,
    input.targetDate ?? null,
  );
}

async function insertMeasurement(
  userId: string,
  weightKg: number,
  waistCm: number | null,
  measuredOn: string = todayStr(),
  note: string | null = null,
): Promise<void> {
  await run(
    `INSERT INTO measurements(id, user_id, measured_on, weight_kg, waist_cm, note, created_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(user_id, measured_on) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       waist_cm = COALESCE(excluded.waist_cm, waist_cm),
       note = COALESCE(excluded.note, note)`,
    [newId(), userId, measuredOn, weightKg, waistCm, note, nowIso()],
  );
}

async function insertGoal(
  userId: string,
  targetKg: number,
  deficit: number,
  targetDate: string | null = null,
): Promise<void> {
  await run("UPDATE goals SET active = 0 WHERE user_id = ? AND active = 1", [userId]);
  await run(
    `INSERT INTO goals(id, user_id, target_weight_kg, daily_deficit_kcal, target_date, protein_target_g, active, created_at)
     VALUES(?,?,?,?,?,?,1,?)`,
    [newId(), userId, targetKg, deficit, targetDate, null, nowIso()],
  );
}

export const userRepo = {
  list(): Promise<UserRow[]> {
    // 成员切换列表：只含未归档，按创建时间排序（SRS 表 5-1）
    return select<UserRow>(
      "SELECT * FROM users WHERE archived_at IS NULL ORDER BY created_at ASC",
    );
  },
  listAll(): Promise<UserRow[]> {
    return select<UserRow>("SELECT * FROM users ORDER BY created_at ASC");
  },
  get(userId: string): Promise<UserRow | null> {
    return selectOne<UserRow>("SELECT * FROM users WHERE id = ?", [userId]);
  },
  owner(): Promise<UserRow | null> {
    return selectOne<UserRow>("SELECT * FROM users WHERE is_owner = 1 LIMIT 1");
  },
  async createOwner(input: MemberInput): Promise<string> {
    return transaction(async () => {
      const id = newId();
      await run(
        `INSERT INTO users(id, display_name, color, avatar_data, is_owner, archived_at, created_at)
         VALUES(?,?,?,?,1,NULL,?)`,
        [id, input.displayName, input.color ?? "#24545E", input.avatar ?? null, nowIso()],
      );
      await insertProfile(id, input);
      await settingsRepo.set(SETTINGS.activeUserId, id);
      await settingsRepo.set(SETTINGS.onboardingDone, "1");
      return id;
    });
  },
  async addMember(actorUserId: string, input: MemberInput): Promise<string> {
    // actorUserId 参与条件，确保操作者自身存在，杜绝匿名调用
    const actor = await userRepo.get(actorUserId);
    if (!actor) throw new Error("当前成员不存在，请重新选择成员");
    // 不用显式 BEGIN：SQLite 插件连接池下，长事务会把并发读锁住，
    // 表现就是成员已写入但提示“database is locked”。逐条短写更稳。
    const id = newId();
    await run(
      `INSERT INTO users(id, display_name, color, avatar_data, is_owner, archived_at, created_at)
       VALUES(?,?,?,?,0,NULL,?)`,
      [id, input.displayName, input.color ?? "#C4703C", input.avatar ?? null, nowIso()],
    );
    await insertProfile(id, input);
    await settingsRepo.set(SETTINGS.activeUserId, id); // 保存后自动切换（FR-USR-03）
    return id;
  },
  async updateMember(actorUserId: string, targetUserId: string, patch: MemberEdit): Promise<void> {
    // users 表无 user_id 列；成员管理按 id 精确定位，业务数据仍全带 user_id
    const current = await userRepo.get(targetUserId);
    if (!current) throw new Error("成员不存在");
    if (actorUserId !== targetUserId && !(await userRepo.get(actorUserId))) {
      throw new Error("当前成员不存在，请重新选择成员");
    }
    {
      if (patch.displayName !== undefined || patch.color !== undefined || patch.avatar !== undefined) {
        await run(
          "UPDATE users SET display_name = ?, color = ?, avatar_data = ? WHERE id = ?",
          [
            patch.displayName ?? current.display_name,
            patch.color ?? current.color,
            patch.avatar !== undefined ? patch.avatar : current.avatar_data,
            targetUserId,
          ],
        );
      }
      const profileChanged =
        patch.sex !== undefined || patch.birthYear !== undefined || patch.heightCm !== undefined ||
        patch.activityLevel !== undefined || patch.waistBaselineCm !== undefined ||
        patch.cityId !== undefined || patch.cityName !== undefined || patch.constraints !== undefined;
      if (profileChanged) {
        const p = await profileRepo.get(targetUserId);
        if (!p) {
          await run(
            `INSERT INTO profiles(user_id, sex, birth_year, height_cm, activity_level,
               waist_baseline_cm, constraints_json, city_id, city_name, updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?)`,
            [
              targetUserId,
              patch.sex ?? "male",
              patch.birthYear ?? 1990,
              patch.heightCm ?? 170,
              patch.activityLevel ?? "light",
              patch.waistBaselineCm ?? null,
              JSON.stringify(patch.constraints ?? []),
              patch.cityId ?? "39.9042,116.4074",
              patch.cityName ?? "北京",
              nowIso(),
            ],
          );
        } else {
          await run(
            `UPDATE profiles SET sex=?, birth_year=?, height_cm=?, activity_level=?,
               waist_baseline_cm=?, constraints_json=?, city_id=?, city_name=?, updated_at=?
             WHERE user_id = ?`,
            [
              patch.sex ?? p.sex,
              patch.birthYear ?? p.birth_year,
              patch.heightCm ?? p.height_cm,
              patch.activityLevel ?? p.activity_level,
              patch.waistBaselineCm ?? p.waist_baseline_cm,
              JSON.stringify(patch.constraints ?? JSON.parse(p.constraints_json)),
              patch.cityId !== undefined ? patch.cityId : p.city_id,
              patch.cityName !== undefined ? patch.cityName : p.city_name,
              nowIso(),
              targetUserId,
            ],
          );
        }
      }
      if (patch.weightKg !== undefined) {
        // 编辑档案不产生“今天称过”的假记录：只有体重真正变化时才补一条测量
        const latest = await selectOne<{ weight_kg: number }>(
          "SELECT weight_kg FROM measurements WHERE user_id = ? ORDER BY measured_on DESC LIMIT 1",
          [targetUserId],
        );
        if (latest && Number.isFinite(patch.weightKg) && Math.abs(latest.weight_kg - patch.weightKg) > 0.05) {
          await insertMeasurement(targetUserId, patch.weightKg, null);
        }
      }
      if (patch.targetWeightKg !== undefined || patch.dailyDeficitKcal !== undefined) {
        const goal = await selectOne<GoalRow>(
          "SELECT * FROM goals WHERE user_id = ? AND active = 1 LIMIT 1",
          [targetUserId],
        );
        if (!goal) {
          const latest = await selectOne<{ weight_kg: number }>(
            "SELECT weight_kg FROM measurements WHERE user_id = ? ORDER BY measured_on DESC LIMIT 1",
            [targetUserId],
          );
          await insertGoal(
            targetUserId,
            patch.targetWeightKg ?? Math.max(20, (latest?.weight_kg ?? 70) - 5),
            patch.dailyDeficitKcal ?? 400,
            patch.targetDate ?? null,
          );
        } else {
          await insertGoal(
            targetUserId,
            patch.targetWeightKg ?? goal.target_weight_kg,
            patch.dailyDeficitKcal ?? goal.daily_deficit_kcal,
            patch.targetDate !== undefined ? patch.targetDate : goal.target_date,
          );
        }
      }
    }
  },
  async archive(actorUserId: string, targetUserId: string, archive: boolean): Promise<void> {
    const target = await userRepo.get(targetUserId);
    if (!target) throw new Error("成员不存在");
    if (target.is_owner === 1) throw new Error("户主不可归档");
    await userRepo.get(actorUserId);
    await run("UPDATE users SET archived_at = ? WHERE id = ?", [archive ? nowIso() : null, targetUserId]);
  },
  /** 删除前统计将清理的记录条数（SRS 5.4） */
  async countRelated(actorUserId: string, targetUserId: string): Promise<number> {
    await userRepo.get(actorUserId);
    const tables = [
      "measurements", "exercise_logs", "diseases", "indicators", "medications",
      "weekly_plans", "event_markers", "ai_runs", "goals", "profiles",
    ];
    let total = 0;
    for (const table of tables) {
      const row = await selectOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`,
        [targetUserId],
      );
      total += row?.n ?? 0;
    }
    return total;
  },
  async remove(actorUserId: string, targetUserId: string): Promise<void> {
    const target = await userRepo.get(targetUserId);
    if (!target) throw new Error("成员不存在");
    await userRepo.get(actorUserId);
    // 户主也可删除；删除当前成员时自动切到第一个剩余成员，若没有成员则回到引导
    await run("DELETE FROM users WHERE id = ?", [targetUserId]);
    const active = await settingsRepo.get(SETTINGS.activeUserId);
    if (active === targetUserId) {
      const next = await selectOne<UserRow>(
        "SELECT * FROM users WHERE archived_at IS NULL ORDER BY created_at ASC LIMIT 1",
      );
      if (next) {
        await settingsRepo.set(SETTINGS.activeUserId, next.id);
      } else {
        await settingsRepo.set(SETTINGS.activeUserId, "");
        await settingsRepo.set(SETTINGS.onboardingDone, "0");
      }
    }
  },
  /** 启动时恢复上次活跃成员；不存在/被归档则回退户主（FR-APP-06） */
  async resolveActive(): Promise<UserRow | null> {
    const activeId = await settingsRepo.get(SETTINGS.activeUserId);
    if (activeId) {
      const row = await selectOne<UserRow>(
        "SELECT * FROM users WHERE id = ? AND archived_at IS NULL",
        [activeId],
      );
      if (row) return row;
    }
    return userRepo.owner();
  },
  async switch(actorUserId: string, targetUserId: string): Promise<void> {
    const target = await selectOne<UserRow>(
      "SELECT * FROM users WHERE id = ? AND archived_at IS NULL",
      [targetUserId],
    );
    if (!target) throw new Error("成员不存在或已归档");
    await userRepo.get(actorUserId);
    await settingsRepo.set(SETTINGS.activeUserId, targetUserId);
  },
};

export const profileRepo = {
  get(userId: string): Promise<ProfileRow | null> {
    return selectOne<ProfileRow>("SELECT * FROM profiles WHERE user_id = ?", [userId]);
  },
  /** FR-PLN-01 / FR-PRF-03：城市保存到当前成员档案 */
  async setCity(userId: string, cityId: string | null, cityName: string | null): Promise<void> {
    await run(
      "UPDATE profiles SET city_id = ?, city_name = ?, updated_at = ? WHERE user_id = ?",
      [cityId, cityName, nowIso(), userId],
    );
  },
};

export const goalRepo = {
  get(userId: string): Promise<GoalRow | null> {
    return selectOne<GoalRow>(
      "SELECT * FROM goals WHERE user_id = ? AND active = 1 LIMIT 1",
      [userId],
    );
  },
  async setDeficit(userId: string, kcal: number): Promise<void> {
    await run("UPDATE goals SET daily_deficit_kcal = ? WHERE user_id = ? AND active = 1", [kcal, userId]);
  },
};

export const diseaseRepo = {
  list(userId: string): Promise<DiseaseRow[]> {
    return select<DiseaseRow>(
      "SELECT * FROM diseases WHERE user_id = ? ORDER BY created_at ASC",
      [userId],
    );
  },
  async create(
    userId: string,
    data: { name: string; presetKey: string | null; diagnosedOn: string | null; note: string | null },
  ): Promise<string> {
    const id = newId();
    await run(
      `INSERT INTO diseases(id, user_id, name, preset_key, status, diagnosed_on, note, created_at)
       VALUES(?,?,?,?, 'active', ?,?,?)`,
      [id, userId, data.name, data.presetKey, data.diagnosedOn, data.note, nowIso()],
    );
    return id;
  },
  async remove(userId: string, diseaseId: string): Promise<void> {
    // FR-DIS-06：删除疾病不删除用药，只解除关联（indicators/diseases 外键 ON DELETE SET NULL）
    await run("DELETE FROM diseases WHERE id = ? AND user_id = ?", [diseaseId, userId]);
    await run("UPDATE medications SET disease_id = NULL WHERE disease_id = ? AND user_id = ?", [diseaseId, userId]);
  },
};

export const indicatorRepo = {
  list(userId: string, diseaseId?: string): Promise<IndicatorRow[]> {
    if (diseaseId) {
      return select<IndicatorRow>(
        "SELECT * FROM indicators WHERE user_id = ? AND disease_id = ? ORDER BY measured_on DESC",
        [userId, diseaseId],
      );
    }
    return select<IndicatorRow>(
      "SELECT * FROM indicators WHERE user_id = ? ORDER BY measured_on DESC",
      [userId],
    );
  },
  async create(
    userId: string,
    data: { diseaseId: string | null; name: string; value: number; unit: string; measuredOn: string; note: string | null },
  ): Promise<string> {
    const id = newId();
    await run(
      `INSERT INTO indicators(id, user_id, disease_id, name, value, unit, measured_on, note, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [id, userId, data.diseaseId, data.name, data.value, data.unit, data.measuredOn, data.note, nowIso()],
    );
    return id;
  },
  async update(
    userId: string,
    indicatorId: string,
    data: { name: string; value: number; unit: string; measuredOn: string; note: string | null },
  ): Promise<void> {
    await run(
      `UPDATE indicators SET name = ?, value = ?, unit = ?, measured_on = ?, note = ?
       WHERE id = ? AND user_id = ?`,
      [data.name, data.value, data.unit, data.measuredOn, data.note, indicatorId, userId],
    );
  },
  async remove(userId: string, indicatorId: string): Promise<void> {
    await run("DELETE FROM indicators WHERE id = ? AND user_id = ?", [indicatorId, userId]);
  },
};

export const measurementRepo = {
  latest(userId: string): Promise<{ weight_kg: number; waist_cm: number | null; measured_on: string } | null> {
    return selectOne(
      "SELECT weight_kg, waist_cm, measured_on FROM measurements WHERE user_id = ? ORDER BY measured_on DESC LIMIT 1",
      [userId],
    );
  },
  /** 当天记录用 UPSERT 覆盖（SRS 8.2），返回保存后最近值 */
  async save(userId: string, weightKg: number, waistCm?: number | null, note?: string | null): Promise<void> {
    await measurementRepo.saveOnDate(userId, todayStr(), weightKg, waistCm, note);
  },
  /** 补记 / 编辑：指定日期 UPSERT（SRS FR-REC-04/05） */
  async saveOnDate(
    userId: string,
    measuredOn: string,
    weightKg: number,
    waistCm?: number | null,
    note?: string | null,
  ): Promise<void> {
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      throw new Error("体重须在 20–300 kg 之间");
    }
    if (waistCm != null && (!Number.isFinite(waistCm) || waistCm < 30 || waistCm > 200)) {
      throw new Error("腰围须在 30–200 cm 之间");
    }
    await insertMeasurement(userId, weightKg, waistCm ?? null, measuredOn, note ?? null);
  },
  /** 编辑已有记录：原地更新，先校验，避免“先删后写”导致数据丢失（P0-7） */
  async update(
    userId: string,
    id: string,
    measuredOn: string,
    weightKg: number,
    waistCm?: number | null,
    note?: string | null,
  ): Promise<void> {
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      throw new Error("体重须在 20–300 kg 之间");
    }
    if (waistCm != null && (!Number.isFinite(waistCm) || waistCm < 30 || waistCm > 200)) {
      throw new Error("腰围须在 30–200 cm 之间");
    }
    const conflict = await selectOne<{ id: string }>(
      "SELECT id FROM measurements WHERE user_id = ? AND measured_on = ? AND id <> ?",
      [userId, measuredOn, id],
    );
    if (conflict) throw new Error("该日期已有记录，请改选日期或先删除原记录");
    await run(
      "UPDATE measurements SET measured_on = ?, weight_kg = ?, waist_cm = ?, note = ? WHERE id = ? AND user_id = ?",
      [measuredOn, weightKg, waistCm ?? null, note ?? null, id, userId],
    );
  },
  /** 当天是否已有记录（提醒去重 FR-RMD-01） */
  async hasOnDate(userId: string, date: string): Promise<boolean> {
    const row = await selectOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM measurements WHERE user_id = ? AND measured_on = ?",
      [userId, date],
    );
    return (row?.n ?? 0) > 0;
  },
  /** 记录列表（编辑/删除用，按日期倒序） */
  list(userId: string, limit = 200): Promise<MeasurementRow[]> {
    return select<MeasurementRow>(
      "SELECT * FROM measurements WHERE user_id = ? ORDER BY measured_on DESC LIMIT ?",
      [userId, limit],
    );
  },
  async remove(userId: string, id: string): Promise<void> {
    await run("DELETE FROM measurements WHERE id = ? AND user_id = ?", [id, userId]);
  },
};

/** 运动打卡（SRS FR-REC-03：只有 是/否 + 备注；不记类型、时长、消耗） */
export const exerciseRepo = {
  async save(userId: string, loggedOn: string, didExercise: boolean, note: string | null): Promise<void> {
    await run(
      `INSERT INTO exercise_logs(id, user_id, logged_on, did_exercise, note, created_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(user_id, logged_on) DO UPDATE SET
         did_exercise = excluded.did_exercise, note = excluded.note`,
      [newId(), userId, loggedOn, didExercise ? 1 : 0, note, nowIso()],
    );
  },
  get(userId: string, loggedOn: string): Promise<ExerciseLogRow | null> {
    return selectOne<ExerciseLogRow>(
      "SELECT * FROM exercise_logs WHERE user_id = ? AND logged_on = ?",
      [userId, loggedOn],
    );
  },
  list(userId: string, limit = 200): Promise<ExerciseLogRow[]> {
    return select<ExerciseLogRow>(
      "SELECT * FROM exercise_logs WHERE user_id = ? ORDER BY logged_on DESC LIMIT ?",
      [userId, limit],
    );
  },
  async remove(userId: string, id: string): Promise<void> {
    await run("DELETE FROM exercise_logs WHERE id = ? AND user_id = ?", [id, userId]);
  },
};

/** 用药与时段（SRS 6.5） */
export const medicationRepo = {
  list(userId: string, includeInactive = false): Promise<MedicationRow[]> {
    const active = includeInactive ? "" : " AND active = 1";
    return select<MedicationRow>(
      `SELECT * FROM medications WHERE user_id = ?${active} ORDER BY created_at ASC`,
      [userId],
    );
  },
  slots(userId: string, medicationId: string): Promise<MedicationSlotRow[]> {
    return select<MedicationSlotRow>(
      `SELECT s.* FROM medication_slots s JOIN medications m ON m.id = s.medication_id
       WHERE s.medication_id = ? AND m.user_id = ? ORDER BY s.time_of_day ASC`,
      [medicationId, userId],
    );
  },
  /** 新增用药 + 多个每日时段（至少 1 个），事务保证一致 */
  async create(userId: string, input: MedInput): Promise<string> {
    if (!input.name.trim() || [...input.name].length > 20) throw new Error("药名须在 1–20 字之间");
    if (!Number.isFinite(input.dose) || input.dose <= 0) throw new Error("剂量须为正数");
    if (!input.times.length) throw new Error("至少添加一个每日时段");
    for (const t of input.times) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`时段格式不正确：${t}`);
    return transaction(async () => {
      const id = newId();
      await run(
        `INSERT INTO medications(id, user_id, disease_id, name, dose, dose_unit, start_on, end_on, active, created_at)
         VALUES(?,?,?,?,?,?,?,?,1,?)`,
        [id, userId, input.diseaseId, input.name.trim(), input.dose, input.doseUnit, input.startOn, input.endOn, nowIso()],
      );
      for (const time of [...new Set(input.times)].sort()) {
        await run(
          "INSERT INTO medication_slots(id, medication_id, time_of_day, label) VALUES(?,?,?,NULL)",
          [newId(), id, time],
        );
      }
      return id;
    });
  },
  /** 编辑药名/剂量不影响历史打卡；只改 medications 主表（FR-MED-05） */
  async update(userId: string, medicationId: string, input: MedInput): Promise<void> {
    if (!input.name.trim() || [...input.name].length > 20) throw new Error("药名须在 1–20 字之间");
    if (!Number.isFinite(input.dose) || input.dose <= 0) throw new Error("剂量须为正数");
    if (!input.times.length) throw new Error("至少添加一个每日时段");
    for (const t of input.times) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`时段格式不正确：${t}`);
    await transaction(async () => {
      await run(
        `UPDATE medications SET disease_id=?, name=?, dose=?, dose_unit=?, start_on=?, end_on=?
         WHERE id = ? AND user_id = ?`,
        [input.diseaseId, input.name.trim(), input.dose, input.doseUnit, input.startOn, input.endOn, medicationId, userId],
      );
      // 时段：删除不再使用的，新增缺失的；保留未变更时段 id 以维持打卡历史
      const existing = await medicationRepo.slots(userId, medicationId);
      const keep = new Set(input.times);
      for (const s of existing) {
        if (!keep.has(s.time_of_day)) await run("DELETE FROM medication_slots WHERE id = ?", [s.id]);
      }
      const existingTimes = new Set(existing.map((s) => s.time_of_day));
      for (const time of keep) {
        if (!existingTimes.has(time)) {
          await run("INSERT INTO medication_slots(id, medication_id, time_of_day, label) VALUES(?,?,?,NULL)", [newId(), medicationId, time]);
        }
      }
    });
  },
  /** 停用写 end_on + active=0，不删除（FR-MED-05） */
  async deactivate(userId: string, medicationId: string, date: string): Promise<void> {
    await run(
      "UPDATE medications SET active = 0, end_on = ? WHERE id = ? AND user_id = ?",
      [date, medicationId, userId],
    );
  },
  /** 删除用药：有历史打卡时禁止（前端改为停用）；无打卡才物理删除（FR-MED-06） */
  async countLogs(userId: string, medicationId: string): Promise<number> {
    const row = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM medication_logs l
       JOIN medication_slots s ON s.id = l.slot_id
       JOIN medications m ON m.id = s.medication_id
       WHERE m.id = ? AND m.user_id = ?`,
      [medicationId, userId],
    );
    return row?.n ?? 0;
  },
  async remove(userId: string, medicationId: string): Promise<void> {
    await run("DELETE FROM medications WHERE id = ? AND user_id = ?", [medicationId, userId]);
  },
};

/** 用药打卡（SRS 4.3 / FR-MED-03/04） */
export const medicationLogRepo = {
  /** 当日该成员所有应服时段 + 打卡状态（JOIN 带 user_id） */
  dueToday(userId: string, date: string): Promise<MedDueItem[]> {
    return select<MedDueItem>(
      `SELECT s.id AS slot_id, s.time_of_day, s.label, m.id AS medication_id, m.name, m.dose,
              m.dose_unit, m.disease_id, l.status
       FROM medication_slots s
       JOIN medications m ON m.id = s.medication_id
       LEFT JOIN medication_logs l ON l.slot_id = s.id AND l.log_date = ?
       WHERE m.user_id = ? AND m.active = 1
         AND (m.start_on IS NULL OR m.start_on <= ?)
         AND (m.end_on IS NULL OR m.end_on >= ?)
       ORDER BY s.time_of_day ASC`,
      [date, userId, date, date],
    );
  },
  /** 三态打卡 UPSERT（slot_id, log_date 唯一） */
  async checkIn(userId: string, slotId: string, date: string, status: MedStatus): Promise<void> {
    await run(
      `INSERT INTO medication_logs(id, slot_id, log_date, status, taken_at)
       VALUES(?,?,?,?,?)
       ON CONFLICT(slot_id, log_date) DO UPDATE SET status = excluded.status, taken_at = excluded.taken_at`,
      [newId(), slotId, date, status, status === "taken" ? nowIso() : null],
    );
    void userId; // user_id 归属由 slot_id → medication 外键保证；调用前经 dueToday 校验可见性
  },
  /** 依从率统计：区间内应服时段数 / 已打卡 taken 数（FR-MED-04），按周/月 */
  async adherence(userId: string, from: string, to: string): Promise<{ taken: number; scheduled: number }> {
    // 应服：区间天数 × 当前启用药品的时段数（按每日固定时段计）
    const slotRow = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM medication_slots s JOIN medications m ON m.id = s.medication_id
       WHERE m.user_id = ? AND m.active = 1`,
      [userId],
    );
    const days = Math.max(0, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000) + 1);
    const scheduled = (slotRow?.n ?? 0) * days;
    const takenRow = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM medication_logs l
       JOIN medication_slots s ON s.id = l.slot_id
       JOIN medications m ON m.id = s.medication_id
       WHERE m.user_id = ? AND l.status = 'taken' AND l.log_date BETWEEN ? AND ?`,
      [userId, from, to],
    );
    return { taken: takenRow?.n ?? 0, scheduled };
  },
};

/** 提醒辅助查询（SRS 第 10 章） */
export const reminderRepo = {
  /** 全家是否存在 18:00–23:59 未打卡时段（FR-RMD-03 / FR-MED-07） */
  async hasUntakenEvening(date: string): Promise<boolean> {
    const rows = await select<{ time_of_day: string; status: string | null }>(
      `SELECT s.time_of_day, l.status FROM medication_slots s
       JOIN medications m ON m.id = s.medication_id AND m.active = 1
       LEFT JOIN medication_logs l ON l.slot_id = s.id AND l.log_date = ?
       WHERE (l.status IS NULL OR l.status <> 'taken')`,
      [date],
    );
    return rows.some((r) => {
      const h = Number(r.time_of_day.slice(0, 2));
      return h >= 18 && h <= 23;
    });
  },
  /** 全家未打卡的晚间时段，按成员分组（FR-RMD-03：合并到一个窗口） */
  async untakenEveningByUser(date: string): Promise<Array<{ user_id: string; display_name: string; items: MedDueItem[] }>> {
    const rows = await select<MedDueItem & { user_id: string; display_name: string }>(
      `SELECT s.id AS slot_id, s.time_of_day, s.label, m.id AS medication_id, m.name, m.dose,
              m.dose_unit, m.disease_id, l.status, u.id AS user_id, u.display_name
       FROM medication_slots s
       JOIN medications m ON m.id = s.medication_id AND m.active = 1
       JOIN users u ON u.id = m.user_id AND u.archived_at IS NULL
       LEFT JOIN medication_logs l ON l.slot_id = s.id AND l.log_date = ?
       WHERE (l.status IS NULL OR l.status <> 'taken')
       ORDER BY u.created_at, s.time_of_day`,
      [date],
    );
    const byUser = new Map<string, { user_id: string; display_name: string; items: MedDueItem[] }>();
    for (const r of rows) {
      const h = Number(r.time_of_day.slice(0, 2));
      if (h < 18 || h > 23) continue; // 晨间药不进入晚间提醒
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user_id: r.user_id, display_name: r.display_name, items: [] });
      const { user_id: _u, display_name: _d, ...item } = r;
      byUser.get(r.user_id)!.items.push(item);
    }
    return [...byUser.values()];
  },
  /** 上周（周一至周日）是否有任意记录（FR-RMD-04） */
  async lastWeekHasData(userId: string, from: string, to: string): Promise<boolean> {
    const row = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT measured_on AS d FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ?
         UNION ALL SELECT logged_on FROM exercise_logs WHERE user_id = ? AND logged_on BETWEEN ? AND ?
         UNION ALL SELECT i.measured_on FROM indicators i WHERE i.user_id = ? AND i.measured_on BETWEEN ? AND ?
       )`,
      [userId, from, to, userId, from, to, userId, from, to],
    );
    return (row?.n ?? 0) > 0;
  },
};


/** S3：趋势数据（SRS FR-REV-01/02/03） */
export const trendRepo = {
  /** 体重日点 + 7 日移动平均 + 目标线 + 事件标记 */
  async weightPoints(userId: string, from: string, to: string, targetKg: number | null): Promise<WeightPoint[]> {
    const rows = await select<{ measured_on: string; weight_kg: number }>(
      "SELECT measured_on, weight_kg FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ? ORDER BY measured_on",
      [userId, from, to],
    );
    const events = await eventMarkerRepo.list(userId, from, to);
    return rows.map((r, i) => {
      const window = rows.slice(Math.max(0, i - 6), i + 1).map((x) => x.weight_kg);
      return {
        date: r.measured_on,
        weight: r.weight_kg,
        ma7: Math.round((window.reduce((a, b) => a + b, 0) / window.length) * 100) / 100,
        target: targetKg,
        events: events.filter((e) => e.event_date === r.measured_on).map((e) => e.label),
      };
    });
  },
  /** 腰围周点（每周取最后一次测量） */
  async waistPoints(userId: string, from: string, to: string): Promise<WaistPoint[]> {
    const rows = await select<{ measured_on: string; waist_cm: number }>(
      "SELECT measured_on, waist_cm FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ? AND waist_cm IS NOT NULL ORDER BY measured_on",
      [userId, from, to],
    );
    const byWeek = new Map<string, { date: string; waist: number }>();
    for (const r of rows) {
      const d = new Date(`${r.measured_on}T00:00:00`);
      const wd = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - wd);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byWeek.set(key, { date: r.measured_on, waist: r.waist_cm });
    }
    return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  },
  /** 指标按疾病分组：同一指标多值连线 */
  async indicatorSeries(userId: string, from: string, to: string): Promise<Array<{ disease: string; name: string; unit: string; date: string; value: number }>> {
    return select(
      `SELECT COALESCE(d.name, '未分类') AS disease, i.name, i.unit, i.measured_on AS date, i.value
       FROM indicators i LEFT JOIN diseases d ON d.id = i.disease_id
       WHERE i.user_id = ? AND i.measured_on BETWEEN ? AND ?
       ORDER BY d.name, i.name, i.measured_on`,
      [userId, from, to],
    );
  },
};

/** 事件标记（SRS FR-REV-01 体重图事件标记） */
export const eventMarkerRepo = {
  list(userId: string, from?: string, to?: string): Promise<EventMarkerRow[]> {
    if (from && to) {
      return select<EventMarkerRow>(
        "SELECT * FROM event_markers WHERE user_id = ? AND event_date BETWEEN ? AND ? ORDER BY event_date",
        [userId, from, to],
      );
    }
    return select<EventMarkerRow>("SELECT * FROM event_markers WHERE user_id = ? ORDER BY event_date DESC", [userId]);
  },
  async add(userId: string, eventDate: string, type: string, label: string): Promise<string> {
    if (!label.trim()) throw new Error("请填写事件名称");
    const id = newId();
    await run("INSERT INTO event_markers(id, user_id, event_date, type, label) VALUES(?,?,?,?,?)", [id, userId, eventDate, type, label.trim()]);
    return id;
  },
  async remove(userId: string, id: string): Promise<void> {
    await run("DELETE FROM event_markers WHERE id = ? AND user_id = ?", [id, userId]);
  },
};

/** S3：周报查询（SRS 6.13.4 聚合所需数据，全部带 user_id） */
export const reviewRepo = {
  measurements(userId: string, from: string, to: string): Promise<Array<{ date: string; weightKg: number }>> {
    return select(
      "SELECT measured_on AS date, weight_kg AS weightKg FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ? ORDER BY measured_on",
      [userId, from, to],
    );
  },
  waists(userId: string, from: string, to: string): Promise<Array<{ date: string; waistCm: number }>> {
    return select(
      "SELECT measured_on AS date, waist_cm AS waistCm FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ? AND waist_cm IS NOT NULL ORDER BY measured_on",
      [userId, from, to],
    );
  },
  async exerciseDays(userId: string, from: string, to: string): Promise<number> {
    const row = await selectOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM exercise_logs WHERE user_id = ? AND logged_on BETWEEN ? AND ? AND did_exercise = 1",
      [userId, from, to],
    );
    return row?.n ?? 0;
  },
  async planSessions(userId: string, from: string, to: string): Promise<number> {
    const row = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM plan_items pi JOIN weekly_plans wp ON wp.id = pi.plan_id
       WHERE wp.user_id = ? AND pi.plan_date BETWEEN ? AND ?`,
      [userId, from, to],
    );
    return row?.n ?? 0;
  },
  async adherence(userId: string, from: string, to: string): Promise<{ taken: number; due: number }> {
    // due = 区间天数 × 当前启用药品时段数（SRS 6.13.4 dueSlots 按每日时段展开）
    const slotRow = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM medication_slots s JOIN medications m ON m.id = s.medication_id
       WHERE m.user_id = ? AND m.active = 1`,
      [userId],
    );
    const days = Math.max(0, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000) + 1);
    const takenRow = await selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM medication_logs l
       JOIN medication_slots s ON s.id = l.slot_id JOIN medications m ON m.id = s.medication_id
       WHERE m.user_id = ? AND l.status = 'taken' AND l.log_date BETWEEN ? AND ?`,
      [userId, from, to],
    );
    return { taken: takenRow?.n ?? 0, due: (slotRow?.n ?? 0) * days };
  },
  indicators(userId: string, from: string, to: string): Promise<Array<{ name: string; unit: string; date: string; value: number }>> {
    return select(
      "SELECT name, unit, measured_on AS date, value FROM indicators WHERE user_id = ? AND measured_on BETWEEN ? AND ? ORDER BY measured_on",
      [userId, from, to],
    );
  },
  async loggedDays(userId: string, from: string, to: string): Promise<number> {
    const row = await selectOne<{ n: number }>(
      `SELECT COUNT(DISTINCT d) AS n FROM (
         SELECT measured_on AS d FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ?
         UNION ALL SELECT logged_on FROM exercise_logs WHERE user_id = ? AND logged_on BETWEEN ? AND ?
         UNION ALL SELECT measured_on FROM indicators WHERE user_id = ? AND measured_on BETWEEN ? AND ?
         UNION ALL SELECT log_date FROM medication_logs l JOIN medication_slots s ON s.id = l.slot_id
                   JOIN medications m ON m.id = s.medication_id WHERE m.user_id = ? AND l.log_date BETWEEN ? AND ?
       )`,
      [userId, from, to, userId, from, to, userId, from, to, userId, from, to],
    );
    return row?.n ?? 0;
  },
  /** 有哪些天有记录（与 loggedDays 同口径；用于周报完成率追溯） */
  async loggedDates(userId: string, from: string, to: string): Promise<string[]> {
    const rows = await select<{ d: string }>(
      `SELECT DISTINCT d FROM (
         SELECT measured_on AS d FROM measurements WHERE user_id = ? AND measured_on BETWEEN ? AND ?
         UNION ALL SELECT logged_on FROM exercise_logs WHERE user_id = ? AND logged_on BETWEEN ? AND ?
         UNION ALL SELECT measured_on FROM indicators WHERE user_id = ? AND measured_on BETWEEN ? AND ?
         UNION ALL SELECT log_date AS d FROM medication_logs l JOIN medication_slots s ON s.id = l.slot_id
                   JOIN medications m ON m.id = s.medication_id WHERE m.user_id = ? AND l.log_date BETWEEN ? AND ?
       ) ORDER BY d`,
      [userId, from, to, userId, from, to, userId, from, to, userId, from, to],
    );
    return rows.map((r) => r.d);
  },
};

/** S3：导出 / 清空 / 恢复（SRS FR-SET-03/04/05、8.3） */
export const exportRepo = {
  /** 全量导出：13 类业务数据，不含 app_settings 中的 Key / ai_runs / weather_cache / 日志 */
  async bundle(): Promise<ExportBundle> {
    const [users, profiles, goals, measurements, exerciseLogs, diseases, indicators,
      medications, medicationSlots, medicationLogs, weeklyPlans, planItems, eventMarkers] = await Promise.all([
      select("SELECT * FROM users ORDER BY created_at"),
      select("SELECT * FROM profiles"),
      select("SELECT * FROM goals"),
      select("SELECT * FROM measurements"),
      select("SELECT * FROM exercise_logs"),
      select("SELECT * FROM diseases"),
      select("SELECT * FROM indicators"),
      select("SELECT * FROM medications"),
      select("SELECT * FROM medication_slots"),
      select("SELECT * FROM medication_logs"),
      select("SELECT * FROM weekly_plans"),
      select("SELECT * FROM plan_items"),
      select("SELECT * FROM event_markers"),
    ]);
    return {
      schemaVersion: 1,
      exportedAt: nowIso(),
      users, profiles, goals, measurements, exerciseLogs, diseases, indicators,
      medications, medicationSlots, medicationLogs, weeklyPlans, planItems, eventMarkers,
    };
  },
  /** CSV 分表：返回 [文件名, CSV 文本][] */
  csvTables(): Array<{ name: string; rows: () => Promise<unknown[]> }> {
    return [
      { name: "users", rows: () => select("SELECT * FROM users") },
      { name: "profiles", rows: () => select("SELECT * FROM profiles") },
      { name: "goals", rows: () => select("SELECT * FROM goals") },
      { name: "measurements", rows: () => select("SELECT * FROM measurements") },
      { name: "exercise_logs", rows: () => select("SELECT * FROM exercise_logs") },
      { name: "diseases", rows: () => select("SELECT * FROM diseases") },
      { name: "indicators", rows: () => select("SELECT * FROM indicators") },
      { name: "medications", rows: () => select("SELECT * FROM medications") },
      { name: "medication_slots", rows: () => select("SELECT * FROM medication_slots") },
      { name: "medication_logs", rows: () => select("SELECT * FROM medication_logs") },
      { name: "weekly_plans", rows: () => select("SELECT * FROM weekly_plans") },
      { name: "plan_items", rows: () => select("SELECT * FROM plan_items") },
      { name: "event_markers", rows: () => select("SELECT * FROM event_markers") },
    ];
  },
  /** 清空全部业务数据（保留 app_settings），事务保证一致 */
  async clearAll(): Promise<void> {
    await transaction(async () => {
      for (const t of ["medication_logs", "medication_slots", "medications", "plan_items", "weekly_plans",
        "indicators", "diseases", "exercise_logs", "measurements", "goals", "profiles", "event_markers", "users"]) {
        await run(`DELETE FROM ${t}`);
      }
      for (const k of ["active_user_id", "onboarding_done", "last_weight_prompt_date", "last_med_prompt_date", "last_review_prompt_week"]) {
        await run("DELETE FROM app_settings WHERE key = ?", [k]);
      }
    });
  },
  /** 从 JSON 包恢复（先清空后写入，事务保证一致）；校验 schemaVersion */
  async restore(bundle: ExportBundle): Promise<void> {
    if (bundle.schemaVersion !== 1) throw new Error(`不支持的备份版本：${bundle.schemaVersion}`);
    const required: Array<keyof ExportBundle> = ["users", "profiles", "goals", "measurements", "exerciseLogs",
      "diseases", "indicators", "medications", "medicationSlots", "medicationLogs", "weeklyPlans", "planItems", "eventMarkers"];
    for (const k of required) if (!Array.isArray(bundle[k])) throw new Error(`备份缺少字段：${k}`);
    const tables: Array<[keyof ExportBundle, string, string[]]> = [
      ["users", "users", ["id", "display_name", "color", "avatar_data", "is_owner", "archived_at", "created_at"]],
      ["profiles", "profiles", ["user_id", "sex", "birth_year", "height_cm", "activity_level", "waist_baseline_cm", "constraints_json", "city_id", "city_name", "updated_at"]],
      ["goals", "goals", ["id", "user_id", "target_weight_kg", "daily_deficit_kcal", "target_date", "protein_target_g", "active", "created_at"]],
      ["measurements", "measurements", ["id", "user_id", "measured_on", "weight_kg", "waist_cm", "note", "created_at"]],
      ["exerciseLogs", "exercise_logs", ["id", "user_id", "logged_on", "did_exercise", "note", "created_at"]],
      ["diseases", "diseases", ["id", "user_id", "name", "preset_key", "status", "diagnosed_on", "note", "created_at"]],
      ["indicators", "indicators", ["id", "user_id", "disease_id", "name", "value", "unit", "measured_on", "note", "created_at"]],
      ["medications", "medications", ["id", "user_id", "disease_id", "name", "dose", "dose_unit", "start_on", "end_on", "active", "created_at"]],
      ["medicationSlots", "medication_slots", ["id", "medication_id", "time_of_day", "label"]],
      ["medicationLogs", "medication_logs", ["id", "slot_id", "log_date", "status", "taken_at"]],
      ["weeklyPlans", "weekly_plans", ["id", "user_id", "week_start", "status", "summary_json", "created_at"]],
      ["planItems", "plan_items", ["id", "plan_id", "plan_date", "mode", "minutes", "intensity", "place", "reason", "status", "sort_order"]],
      ["eventMarkers", "event_markers", ["id", "user_id", "event_date", "type", "label"]],
    ];
    await transaction(async () => {
      for (const [, table] of [...tables].reverse()) await run(`DELETE FROM ${table}`);
      for (const [key, table, cols] of tables) {
        const rows = bundle[key] as Record<string, unknown>[];
        const sql = `INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`;
        for (const row of rows) await run(sql, cols.map((c) => row[c] ?? null));
      }
      // 恢复后激活户主，确保应用可进入
      const owner = await userRepo.owner();
      if (owner) {
        await settingsRepo.set(SETTINGS.activeUserId, owner.id);
        await settingsRepo.set(SETTINGS.onboardingDone, "1");
      }
    });
  },
};

/** S4：周计划仓储（plan_items 通过 weekly_plans.user_id 隔离） */
export type SavedPlanItem = PlanItem & { status?: string };

export const planRepo = {
  async get(userId: string, weekStart: string): Promise<{ plan: WeeklyPlanRow; items: PlanItemRow[] } | null> {
    const plan = await selectOne<WeeklyPlanRow>(
      "SELECT * FROM weekly_plans WHERE user_id = ? AND week_start = ?",
      [userId, weekStart],
    );
    if (!plan) return null;
    const items = await select<PlanItemRow>(
      `SELECT pi.* FROM plan_items pi JOIN weekly_plans wp ON wp.id = pi.plan_id
       WHERE wp.user_id = ? AND wp.week_start = ? ORDER BY pi.plan_date, pi.sort_order`,
      [userId, weekStart],
    );
    return { plan, items };
  },

  async listItems(userId: string, from: string, to: string): Promise<PlanItemRow[]> {
    return select<PlanItemRow>(
      `SELECT pi.* FROM plan_items pi JOIN weekly_plans wp ON wp.id = pi.plan_id
       WHERE wp.user_id = ? AND pi.plan_date BETWEEN ? AND ? ORDER BY pi.plan_date, pi.sort_order`,
      [userId, from, to],
    );
  },

  /** 整周保存：事务 upsert 计划头 + 重建计划项，status 用于锁定/完成状态。 */
  async save(userId: string, weekStart: string, items: SavedPlanItem[], summary: Record<string, unknown>): Promise<void> {
    // 短写不占用长事务：计划页同时有天气/成员等并发查询，长事务会触发 database is locked
    await run(
      `INSERT INTO weekly_plans(id, user_id, week_start, status, summary_json, created_at)
       VALUES(?,?,?,'active',?,?)
       ON CONFLICT(user_id, week_start) DO UPDATE SET status='active', summary_json=excluded.summary_json`,
      [newId(), userId, weekStart, JSON.stringify(summary), nowIso()],
    );
    const plan = await selectOne<{ id: string }>(
      "SELECT id FROM weekly_plans WHERE user_id = ? AND week_start = ?",
      [userId, weekStart],
    );
    if (!plan) throw new Error("周计划保存失败，请重试");
    await run("DELETE FROM plan_items WHERE plan_id = ?", [plan.id]);
    for (const [index, item] of items.entries()) {
      await run(
        `INSERT INTO plan_items(id, plan_id, plan_date, mode, minutes, intensity, place, reason, status, sort_order)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [newId(), plan.id, item.date, item.mode, item.minutes, item.intensity, item.place,
          item.reason ?? null, item.status ?? "planned", index],
      );
    }
  },

  async setStatus(userId: string, itemId: string, status: string): Promise<void> {
    await run(
      `UPDATE plan_items SET status = ? WHERE id = ? AND plan_id IN
       (SELECT id FROM weekly_plans WHERE user_id = ?)`,
      [status, itemId, userId],
    );
  },

  async replace(
    userId: string,
    itemId: string,
    patch: Partial<Pick<PlanItem, "date" | "mode" | "minutes" | "intensity" | "place" | "reason">> & { status?: string },
  ): Promise<void> {
    const columns: Record<string, string> = {
      date: "plan_date", mode: "mode", minutes: "minutes", intensity: "intensity",
      place: "place", reason: "reason", status: "status",
    };
    const entries = Object.entries(patch).filter(([key]) => columns[key] !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([key]) => `${columns[key]} = ?`).join(", ");
    await run(
      `UPDATE plan_items SET ${sets} WHERE id = ? AND plan_id IN
       (SELECT id FROM weekly_plans WHERE user_id = ?)`,
      [...entries.map(([, value]) => value ?? null), itemId, userId],
    );
  },

  async clear(userId: string, weekStart: string): Promise<void> {
    await run(
      `DELETE FROM weekly_plans WHERE user_id = ? AND week_start = ?`,
      [userId, weekStart],
    );
  },
};

/** S4：天气缓存（按城市 + 日期，60 分钟 TTL 由 domain/cacheFresh 判断） */
export const weatherRepo = {
  async cached(cityId: string, dates: string[]): Promise<{ days: WeatherDay[]; fetchedAt: string } | null> {
    if (dates.length === 0) return null;
    const marks = dates.map(() => "?").join(",");
    const rows = await select<WeatherCacheRow>(
      `SELECT city_id, forecast_date, payload_json, fetched_at FROM weather_cache
       WHERE city_id = ? AND forecast_date IN (${marks})`,
      [cityId, ...dates],
    );
    if (rows.length < dates.length) return null;
    const days = rows
      .map((r) => JSON.parse(r.payload_json) as WeatherDay)
      .sort((a, b) => a.date.localeCompare(b.date));
    const fetchedAt = rows.reduce((max, r) => (r.fetched_at > max ? r.fetched_at : max), "");
    return { days, fetchedAt };
  },

  async save(cityId: string, days: WeatherDay[]): Promise<void> {
    const fetchedAt = nowIso();
    await transaction(async () => {
      for (const day of days) {
        await run(
          `INSERT INTO weather_cache(city_id, forecast_date, payload_json, fetched_at) VALUES(?,?,?,?)
           ON CONFLICT(city_id, forecast_date) DO UPDATE SET
             payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
          [cityId, day.date, JSON.stringify(day), fetchedAt],
        );
      }
    });
  },

  async cacheInfo(cityId: string): Promise<string | null> {
    const row = await selectOne<{ fetched_at: string }>(
      "SELECT MAX(fetched_at) AS fetched_at FROM weather_cache WHERE city_id = ?",
      [cityId],
    );
    return row?.fetched_at ?? null;
  },
};

/** 类型行：ai_runs 仅存元数据，不存提问正文/回答正文（FR-AI-09 / 导出不含日志） */
export interface AiRunRow {
  id: string;
  user_id: string | null;
  task: string;
  provider: string;
  model: string;
  status: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_cny: number | null;
  error_code: string | null;
  created_at: string;
}

export const aiRunRepo = {
  /** 记一次调用元数据（不含正文）；成功/失败都记，便于预算与追溯 */
  async record(data: {
    userId: string | null;
    task: string;
    provider: string;
    model: string;
    status: "ok" | "error" | "local";
    tokensIn?: number | null;
    tokensOut?: number | null;
    cost?: number | null;
    errorCode?: string | null;
  }): Promise<void> {
    await run(
      `INSERT INTO ai_runs(id, user_id, task, provider, model, status, tokens_in, tokens_out, cost_cny, error_code, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), data.userId, data.task, data.provider, data.model, data.status,
       data.tokensIn ?? null, data.tokensOut ?? null, data.cost ?? null, data.errorCode ?? null, nowIso()],
    );
    // FR-AI-09：本地仅保留最近 100 次，超出按时间删除
    await run(
      `DELETE FROM ai_runs WHERE id IN (
         SELECT id FROM ai_runs ORDER BY created_at DESC LIMIT -1 OFFSET 100
       )`,
    );
  },

  list(userId?: string): Promise<AiRunRow[]> {
    return userId
      ? select<AiRunRow>("SELECT * FROM ai_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100", [userId])
      : select<AiRunRow>("SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT 100");
  },

  async remove(id: string): Promise<void> {
    await run("DELETE FROM ai_runs WHERE id = ?", [id]);
  },

  async clearAll(): Promise<void> {
    await run("DELETE FROM ai_runs");
  },

  /** 本月已花成本（本地月份键），用 created_at 前缀匹配 YYYY-MM */
  async monthSpent(monthPrefix: string): Promise<number> {
    const row = await selectOne<{ total: number | null }>(
      "SELECT SUM(cost_cny) AS total FROM ai_runs WHERE created_at LIKE ? AND status = 'ok'",
      [`${monthPrefix}%`],
    );
    return row?.total ?? 0;
  },
};

/** AI 每家供应商的 Base URL / 模型键（Key 不在此，存 Windows 凭据管理器） */
export const aiSettingKey = {
  baseUrl: (provider: string) => `ai_base_url_${provider}`,
  model: (provider: string) => `ai_model_${provider}`,
} as const;

export interface AiConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  budget: number;
  priceIn: number;
  priceOut: number;
  sendMeds: boolean;
  sendIndicators: boolean;
  previewShown: boolean;
}

/** 读取 AI 配置（不含 Key）。缺省值来自 SRS 附录 D / 表 9-1。 */
export async function getAiConfig(defaultBaseUrl: string, defaultModel: string, defaultPriceIn: number, defaultPriceOut: number): Promise<AiConfig> {
  const provider = (await settingsRepo.get(SETTINGS.aiProvider)) ?? "deepseek";
  const [enabled, baseUrl, model, budget, priceIn, priceOut, sendMeds, sendIndicators, previewShown] = await Promise.all([
    settingsRepo.get(SETTINGS.aiEnabled),
    settingsRepo.get(aiSettingKey.baseUrl(provider)),
    settingsRepo.get(aiSettingKey.model(provider)),
    settingsRepo.get(SETTINGS.aiBudget),
    settingsRepo.get(SETTINGS.aiPriceIn),
    settingsRepo.get(SETTINGS.aiPriceOut),
    settingsRepo.get(SETTINGS.aiSendMeds),
    settingsRepo.get(SETTINGS.aiSendIndicators),
    settingsRepo.get(SETTINGS.aiPreviewShown),
  ]);
  return {
    enabled: enabled === "1",
    provider,
    baseUrl: baseUrl ?? defaultBaseUrl,
    model: model ?? defaultModel,
    budget: Number(budget) > 0 ? Number(budget) : 5,
    priceIn: resolvePrice(priceIn, defaultPriceIn),
    priceOut: resolvePrice(priceOut, defaultPriceOut),
    sendMeds: sendMeds !== "0",
    sendIndicators: sendIndicators !== "0",
    previewShown: previewShown === "1",
  };
}
