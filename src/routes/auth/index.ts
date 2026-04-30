import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'

// ── SCHEMAS ────────────────────────────────────────────────────────────────────
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(50),
  surname: z.string().min(1).max(50),
  city: z.string().optional().default('Madrid'),
  birth_year: z.number().int().min(1920).max(2010).optional(),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const RefreshSchema = z.object({
  refresh_token: z.string(),
})

// ── PLUGIN ─────────────────────────────────────────────────────────────────────
const authRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /auth/register
  fastify.post('/register', async (request, reply) => {
    const body = RegisterSchema.parse(request.body)
    const { db } = fastify

    // Verificar email único
    const [existing] = await db`
      SELECT id FROM users WHERE email = ${body.email} LIMIT 1
    `
    if (existing) {
      return reply.code(409).send({
        success: false,
        error: { code: 'EMAIL_TAKEN', message: 'El email ya está registrado' },
      })
    }

    // Hash contraseña
    const password_hash = await bcrypt.hash(body.password, 12)
    const user_id = uuid()

    // Crear usuario con plan free
    await db`
      INSERT INTO users (id, email, password_hash, name, surname, city, birth_year, plan, active_modules)
      VALUES (${user_id}, ${body.email}, ${password_hash}, ${body.name}, ${body.surname},
              ${body.city}, ${body.birth_year ?? null}, 'free', ARRAY['emotional'])
    `

    // Preferencias por defecto
    await db`
      INSERT INTO user_preferences (user_id)
      VALUES (${user_id})
    `

    // Generar tokens
    const access_token = fastify.jwt.sign(
      { sub: user_id, email: body.email, plan: 'free' },
      { expiresIn: '7d' }
    )
    const refresh_token = fastify.jwt.sign(
      { sub: user_id, type: 'refresh' },
      { expiresIn: '30d' }
    )

    await fastify.redis.setEx(
      `refresh:${user_id}`,
      30 * 24 * 60 * 60,
      refresh_token
    )

    return reply.code(201).send({
      success: true,
      data: {
        user: { id: user_id, email: body.email, name: body.name, surname: body.surname, plan: 'free' },
        tokens: { access_token, refresh_token, expires_in: 7 * 24 * 60 * 60 },
      },
    })
  })

  // POST /auth/login
  fastify.post('/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body)
    const { db } = fastify

    const [user] = await db`
      SELECT id, email, password_hash, name, surname, plan
      FROM users
      WHERE email = ${body.email}
      LIMIT 1
    `

    if (!user) {
      return reply.code(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email o contraseña incorrectos' },
      })
    }

    const valid = await bcrypt.compare(body.password, user.password_hash)
    if (!valid) {
      return reply.code(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email o contraseña incorrectos' },
      })
    }

    const access_token = fastify.jwt.sign(
      { sub: user.id, email: user.email, plan: user.plan },
      { expiresIn: '7d' }
    )
    const refresh_token = fastify.jwt.sign(
      { sub: user.id, type: 'refresh' },
      { expiresIn: '30d' }
    )

    await fastify.redis.setEx(`refresh:${user.id}`, 30 * 24 * 60 * 60, refresh_token)

    // Actualizar last_login
    await db`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`

    return reply.send({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, surname: user.surname || '', plan: user.plan },
        tokens: { access_token, refresh_token, expires_in: 7 * 24 * 60 * 60 },
      },
    })
  })

  // POST /auth/refresh
  fastify.post('/refresh', async (request, reply) => {
    const { refresh_token } = RefreshSchema.parse(request.body)

    let payload: any
    try {
      payload = fastify.jwt.verify(refresh_token)
    } catch {
      return reply.code(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Token de refresco inválido' },
      })
    }

    // Verificar que el refresh token coincide con el almacenado
    const stored = await fastify.redis.get(`refresh:${payload.sub}`)
    if (stored !== refresh_token) {
      return reply.code(401).send({
        success: false,
        error: { code: 'TOKEN_REUSED', message: 'Token de refresco inválido o ya usado' },
      })
    }

    const [user] = await fastify.db`
      SELECT id, email, plan FROM users WHERE id = ${payload.sub} LIMIT 1
    `
    if (!user) {
      return reply.code(401).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' },
      })
    }

    const new_access_token = fastify.jwt.sign(
      { sub: user.id, email: user.email, plan: user.plan },
      { expiresIn: '7d' }
    )

    return reply.send({
      success: true,
      data: { access_token: new_access_token, expires_in: 7 * 24 * 60 * 60 },
    })
  })

  // POST /auth/logout
  fastify.post('/logout', {
    preHandler: async (req, rep) => { try { await req.jwtVerify() } catch { return rep.code(401).send({ success: false }) } }
  }, async (request, reply) => {
    await fastify.redis.del(`refresh:${request.user!.sub}`)
    return reply.send({ success: true, data: { message: 'Sesión cerrada correctamente' } })
  })

  // GET /auth/me
  fastify.get('/me', {
    preHandler: async (req, rep) => { try { await req.jwtVerify() } catch { return rep.code(401).send({ success: false }) } }
  }, async (request, reply) => {
    const [user] = await fastify.db`
      SELECT u.id, u.email, u.name, u.surname, u.city, u.birth_year, u.plan,
             u.active_modules, u.interests, u.created_at,
             p.silence_start, p.silence_end, p.checkin_enabled,
             p.max_daily_alerts, p.notification_channel
      FROM users u
      LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = ${request.user!.sub}
      LIMIT 1
    `
    if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } })
    return reply.send({ success: true, data: user })
  })
}

export default authRoutes
