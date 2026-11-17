-- WeightCoach 001_init.sql
-- 数据库：SQLite 单文件 %APPDATA%/WeightCoach/weightcoach.db
-- 约定：开启外键；所有日期为本地 YYYY-MM-DD；布尔用 0/1

PRAGMA foreign_keys = ON;

-- users / profiles / goals
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 12),
  color TEXT NOT NULL DEFAULT '#24545E',
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_owner IN (0,1)),
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sex TEXT NOT NULL CHECK(sex IN ('male','female')),
  birth_year INTEGER NOT NULL CHECK(birth_year BETWEEN 1900 AND 2100),
  height_cm REAL NOT NULL CHECK(height_cm BETWEEN 100 AND 250),
  activity_level TEXT NOT NULL CHECK(activity_level IN ('sedentary','light','moderate','active')),
  waist_baseline_cm REAL,
  constraints_json TEXT NOT NULL DEFAULT '[]',
  city_id TEXT,
  city_name TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_weight_kg REAL NOT NULL,
  daily_deficit_kcal INTEGER NOT NULL DEFAULT 400,
  protein_target_g REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_goals_active ON goals(user_id) WHERE active = 1;

-- records
CREATE TABLE measurements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on TEXT NOT NULL,
  weight_kg REAL CHECK(weight_kg BETWEEN 20 AND 300),
  waist_cm REAL CHECK(waist_cm BETWEEN 30 AND 200),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, measured_on)
);

CREATE TABLE exercise_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_on TEXT NOT NULL,
  did_exercise INTEGER NOT NULL CHECK(did_exercise IN (0,1)),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, logged_on)
);

-- diseases / indicators
CREATE TABLE diseases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  preset_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','remission')),
  diagnosed_on TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE indicators (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disease_id TEXT REFERENCES diseases(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  measured_on TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ind_user_date ON indicators(user_id, measured_on);

-- medications
CREATE TABLE medications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  disease_id TEXT REFERENCES diseases(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  dose REAL NOT NULL,
  dose_unit TEXT NOT NULL,
  start_on TEXT,
  end_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE medication_slots (
  id TEXT PRIMARY KEY,
  medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  time_of_day TEXT NOT NULL CHECK(time_of_day BETWEEN '00:00' AND '23:59'),
  label TEXT,
  UNIQUE(medication_id, time_of_day)
);

CREATE TABLE medication_logs (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES medication_slots(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('taken','skipped','missed')),
  taken_at TEXT,
  UNIQUE(slot_id, log_date)
);

-- plans / weather
CREATE TABLE weekly_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  summary_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, week_start)
);

CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  plan_date TEXT NOT NULL,
  mode TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  intensity TEXT NOT NULL,
  place TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE weather_cache (
  city_id TEXT NOT NULL,
  forecast_date TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(city_id, forecast_date)
);

-- ai / markers / settings
CREATE TABLE ai_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_cny REAL,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE event_markers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
