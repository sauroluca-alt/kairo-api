-- ── KAIRO DATABASE SCHEMA v1.0 ───────────────────────────────────────────────
-- PostgreSQL 16 + Supabase
-- Ejecutar en orden

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── USUARIOS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  surname         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT 'Madrid',
  birth_year      INTEGER,
  plan            TEXT NOT NULL DEFAULT 'koral'
                  CHECK (plan IN ('koral','turkuoise','kpro','tpro')),
  active_modules  TEXT[] NOT NULL DEFAULT ARRAY['sport','legal'],
  interests       TEXT[] NOT NULL DEFAULT '{}',
  fcm_token       TEXT,
  last_login      TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ── PREFERENCIAS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  silence_start        TIME NOT NULL DEFAULT '22:00',
  silence_end          TIME NOT NULL DEFAULT '08:00',
  silence_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  checkin_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  checkin_time         TIME NOT NULL DEFAULT '09:00',
  max_daily_alerts     INTEGER NOT NULL DEFAULT 5 CHECK (max_daily_alerts BETWEEN 1 AND 50),
  notification_channel TEXT NOT NULL DEFAULT 'push'
                       CHECK (notification_channel IN ('push','email','whatsapp')),
  timezone             TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ALERTAS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id        TEXT NOT NULL,
  module         TEXT NOT NULL CHECK (module IN ('sport','legal','emotional','social','financial')),
  type           TEXT NOT NULL CHECK (type IN ('urgent','warning','suggestion','motivation','connection')),
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','delivered','read','acted','dismissed','snoozed')),
  primary_action  JSONB,
  secondary_action JSONB,
  metadata       JSONB DEFAULT '{}',
  scheduled_for  TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_user_id    ON alerts(user_id);
CREATE INDEX idx_alerts_status     ON alerts(status);
CREATE INDEX idx_alerts_module     ON alerts(module);
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);

-- ── FEEDBACK DE ALERTAS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_feedback (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id   UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  payload    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CUENTAS BANCARIAS (Open Banking) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_accounts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tink_id      TEXT UNIQUE,
  bank_name    TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'checking',
  iban_masked  TEXT,
  currency     TEXT NOT NULL DEFAULT 'EUR',
  balance      DECIMAL(12,2),
  sync_status  TEXT NOT NULL DEFAULT 'pending',
  last_sync    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_financial_accounts_user ON financial_accounts(user_id);

-- ── TRANSACCIONES ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id     UUID NOT NULL REFERENCES financial_accounts(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tink_tx_id     TEXT UNIQUE,
  amount         DECIMAL(12,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'EUR',
  description    TEXT,
  category       TEXT,
  merchant_name  TEXT,
  tx_date        DATE NOT NULL,
  tx_type        TEXT NOT NULL DEFAULT 'debit' CHECK (tx_type IN ('credit','debit')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user     ON financial_transactions(user_id);
CREATE INDEX idx_transactions_date     ON financial_transactions(tx_date DESC);
CREATE INDEX idx_transactions_category ON financial_transactions(category);

-- ── PRESUPUESTOS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_budgets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  amount     DECIMAL(12,2) NOT NULL,
  period     TEXT NOT NULL DEFAULT 'monthly',
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, category, period)
);

-- ── OBJETIVOS DE AHORRO ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS financial_goals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  target       DECIMAL(12,2) NOT NULL,
  current      DECIMAL(12,2) NOT NULL DEFAULT 0,
  deadline     DATE,
  completed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CONEXIONES SOCIALES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_connections (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id_1   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_2   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','accepted','rejected','blocked')),
  match_score INTEGER CHECK (match_score BETWEEN 0 AND 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id_1, user_id_2),
  CHECK (user_id_1 != user_id_2)
);

-- ── CHECK-INS EMOCIONALES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mood_checkins (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood       INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
  energy     INTEGER CHECK (energy BETWEEN 1 AND 5),
  stress     INTEGER CHECK (stress BETWEEN 1 AND 5),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checkins_user_date ON mood_checkins(user_id, created_at DESC);

-- ── FUNCIÓN UPDATED_AT AUTOMÁTICO ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a todas las tablas con updated_at
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','user_preferences','alerts','financial_accounts',
    'financial_transactions','financial_budgets','financial_goals',
    'social_connections'] LOOP
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t);
  END LOOP;
END $$;

-- ── ROW LEVEL SECURITY (Supabase) ─────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mood_checkins ENABLE ROW LEVEL SECURITY;
