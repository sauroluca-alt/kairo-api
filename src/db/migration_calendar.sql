-- ── KAIRO CALENDAR TABLE ──────────────────────────────────────────────────────
-- Ejecutar en Supabase SQL Editor

CREATE TABLE IF NOT EXISTS calendar_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  time       TEXT NOT NULL DEFAULT 'Todo el día',
  end_time   TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT 'WORK'
             CHECK (category IN ('WORK','SPORT','HEALTH','FAMILY','SOCIAL','FINANCE')),
  event_date DATE NOT NULL,
  is_kairo   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calendar_events_user_date ON calendar_events(user_id, event_date);
