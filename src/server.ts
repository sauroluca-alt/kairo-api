import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'

import dbPlugin from './plugins/db.js'
import redisPlugin from './plugins/redis.js'

import authRoutes   from './routes/auth/index.js'
import usersRoutes  from './routes/users/index.js'
import alertsRoutes from './routes/alerts/index.js'
import healthRoutes from './routes/health/index.js'
import chatRoutes     from './routes/chat/index.js'
import checkinsRoutes from './routes/checkins/index.js'
import financeRoutes  from './routes/finance/index.js'
import sportRoutes    from './routes/sport/index.js'
import socialRoutes   from './routes/social/index.js'
import calendarRoutes from './routes/calendar/index.js'
import plansRoutes    from './routes/plans/index.js'

const server = Fastify({
  logger: {
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  },
})

async function bootstrap() {

  await server.register(helmet, { contentSecurityPolicy: false })

  await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  })

  await server.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000'),
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones. Inténtalo más tarde.' },
    }),
  })

  await server.register(jwt, {
    secret: process.env.JWT_SECRET!,
  })

  await server.register(dbPlugin)
  await server.register(redisPlugin)

  // ── MIGRACIONES AUTOMÁTICAS ────────────────────────────────────────────────
  try {
    await server.db`
      CREATE TABLE IF NOT EXISTS sport_plans (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        objective      TEXT NOT NULL,
        level          TEXT NOT NULL,
        training_plan  JSONB NOT NULL,
        nutrition_plan JSONB NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    server.log.info('✅ Migración sport_plans OK')

    await server.db`
      CREATE TABLE IF NOT EXISTS user_detected_interests (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        interest_type    TEXT NOT NULL,
        interest_value   TEXT NOT NULL,
        confidence       FLOAT NOT NULL DEFAULT 0.8,
        detection_count  INT NOT NULL DEFAULT 1,
        detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, interest_type, interest_value)
      )
    `
    await server.db`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT
    `
    server.log.info('✅ Migración fcm_token OK')
  } catch (err) {
    server.log.warn({ err }, 'Migración sport_plans ya existía o error menor')
  }

  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error)
    if (error.name === 'ZodError') {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Datos inválidos', details: error.message },
      })
    }
    if (error.statusCode === 401) {
      return reply.code(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'No autorizado' },
      })
    }
    return reply.code(error.statusCode ?? 500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
    })
  })

  const prefix = `/api/${process.env.API_VERSION ?? 'v1'}`

  await server.register(healthRoutes, { prefix: `${prefix}/health` })
  await server.register(authRoutes,   { prefix: `${prefix}/auth` })
  await server.register(usersRoutes,  { prefix: `${prefix}/users` })
  await server.register(alertsRoutes, { prefix: `${prefix}/alerts` })
  await server.register(chatRoutes,     { prefix: `${prefix}/chat` })
  await server.register(checkinsRoutes, { prefix: `${prefix}/checkins` })
  await server.register(financeRoutes,  { prefix: `${prefix}/finance` })
  await server.register(sportRoutes,    { prefix: `${prefix}/sport` })
  await server.register(socialRoutes,   { prefix: `${prefix}/social` })
  await server.register(calendarRoutes, { prefix: `${prefix}/calendar` })
  await server.register(plansRoutes,    { prefix: `${prefix}/plans` })

  server.log.info(`✅ Rutas de plans registradas en ${prefix}/plans`)

  server.get('/', async () => ({
    name: 'Kairo API',
    version: '1.0.0',
    health: `${prefix}/health`,
  }))

  const port = parseInt(process.env.PORT ?? '3001')
  const host = process.env.HOST ?? '0.0.0.0'

  await server.listen({ port, host })
  server.log.info(`🚀 Kairo API corriendo en http://${host}:${port}`)
  server.log.info(`📋 Rutas:`)
  server.log.info(`   GET  ${prefix}/health`)
  server.log.info(`   POST ${prefix}/auth/register`)
  server.log.info(`   POST ${prefix}/auth/login`)
  server.log.info(`   GET  ${prefix}/users/me/profile`)
  server.log.info(`   GET  ${prefix}/alerts`)
  server.log.info(`   POST ${prefix}/chat/message`)
}

bootstrap().catch((err) => {
  console.error('❌ Error arrancando el servidor:', err)
  process.exit(1)
})

const signals = ['SIGINT', 'SIGTERM']
signals.forEach((signal) => {
  process.on(signal, async () => {
    server.log.info(`${signal} recibido. Cerrando...`)
    await server.close()
    process.exit(0)
  })
})
