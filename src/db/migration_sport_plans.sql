-- Ejecutar en Supabase SQL Editor
CREATE TABLE IF NOT EXISTS sport_plans (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  objective      TEXT NOT NULL,
  level          TEXT NOT NULL,
  training_plan  JSONB NOT NULL,
  nutrition_plan JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
