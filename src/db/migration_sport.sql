-- ── KAIRO SPORT TABLES ────────────────────────────────────────────────────────
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sport_workouts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  duration   INTEGER NOT NULL,          -- minutos
  calories   INTEGER NOT NULL DEFAULT 0,
  distance   DECIMAL(6,2),              -- km
  notes      TEXT DEFAULT '',
  worked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sport_workouts_user_date ON sport_workouts(user_id, worked_at DESC);

CREATE TABLE IF NOT EXISTS sport_daily_stats (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stat_date           DATE NOT NULL DEFAULT CURRENT_DATE,
  steps               INTEGER NOT NULL DEFAULT 0,
  calories_burned     INTEGER,
  sleep_hours         DECIMAL(4,2),
  heart_rate_resting  INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, stat_date)
);

CREATE INDEX idx_sport_daily_stats_user_date ON sport_daily_stats(user_id, stat_date DESC);
