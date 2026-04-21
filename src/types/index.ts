// ── TIPOS GLOBALES DE KAIRO API ───────────────────────────────────────────────

export type UUID = string

export type KairoModule = 'sport' | 'legal' | 'emotional' | 'social' | 'financial'

export type AlertType = 'urgent' | 'warning' | 'suggestion' | 'motivation' | 'connection'

export type AlertStatus = 'pending' | 'delivered' | 'read' | 'acted' | 'dismissed' | 'snoozed'

export type UserPlan = 'koral' | 'turkuoise' | 'kpro' | 'tpro'

export type NotificationChannel = 'push' | 'email' | 'whatsapp'

// ── USUARIO ────────────────────────────────────────────────────────────────────
export interface User {
  id: UUID
  email: string
  name: string
  surname: string
  city: string
  birth_year: number
  plan: UserPlan
  active_modules: KairoModule[]
  interests: string[]
  created_at: Date
  updated_at: Date
}

export interface UserPreferences {
  user_id: UUID
  silence_start: string        // "22:00"
  silence_end: string          // "08:00"
  checkin_enabled: boolean
  checkin_time: string         // "09:00"
  max_daily_alerts: number
  notification_channel: NotificationChannel
  timezone: string             // "Europe/Madrid"
}

// ── ALERTA ─────────────────────────────────────────────────────────────────────
export interface KairoAlert {
  id: UUID
  user_id: UUID
  rule_id: string              // "LAB-01", "FIN-02"
  module: KairoModule
  type: AlertType
  title: string
  description: string
  priority: 1 | 2 | 3 | 4
  status: AlertStatus
  primary_action?: AlertAction
  secondary_action?: AlertAction
  metadata?: Record<string, unknown>
  scheduled_for?: Date
  delivered_at?: Date
  read_at?: Date
  created_at: Date
  updated_at: Date
}

export interface AlertAction {
  label: string
  action_key: string
  payload?: Record<string, unknown>
}

// ── API RESPONSES ──────────────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: ApiError
  meta?: PaginationMeta
}

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  total_pages: number
}

// ── AUTH ───────────────────────────────────────────────────────────────────────
export interface AuthTokens {
  access_token: string
  refresh_token: string
  expires_in: number
}

export interface JWTPayload {
  sub: UUID          // user_id
  email: string
  plan: UserPlan
  iat: number
  exp: number
}

// ── FASTIFY AUGMENTATION ───────────────────────────────────────────────────────
declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload
  }
}
