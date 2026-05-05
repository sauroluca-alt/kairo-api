import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import type { KairoModule, NotificationChannel } from '../../types/index.js'

const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  surname: z.string().min(1).max(50).optional(),
  city: z.string().max(100).optional(),
  birth_year: z.number().int().min(1920).max(2010).optional(),
  interests: z.array(z.string()).max(20).optional(),
})

const UpdateModulesSchema = z.object({
  active_modules: z.array(
    z.enum(['sport', 'legal', 'emotional', 'social', 'financial'])
  ).min(1).max(5),
})

const UpdatePreferencesSchema = z.object({
  silence_start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  silence_end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  checkin_enabled: z.boolean().optional(),
  checkin_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  max_daily_alerts: z.number().int().min(1).max(50).optional(),
  notification_channel: z.enum(['push', 'email', 'whatsapp']).optional(),
  timezone: z.string().optional(),
})

const usersRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /users/me/profile
  fastify.get('/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    const [user] = await fastify.db`
      SELECT u.id, u.email, u.name, u.surname, u.city, u.birth_year,
             u.plan, u.active_modules, u.interests, u.created_at,
             p.silence_start, p.silence_end, p.checkin_enabled, p.checkin_time,
             p.max_daily_alerts, p.notification_channel, p.timezone
      FROM users u
      LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = ${request.user!.sub}
      LIMIT 1
    `
    if (!user) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } })
    return reply.send({ success: true, data: user })
  })

  // PATCH /users/me/profile
  fastify.patch('/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    const updates = UpdateProfileSchema.parse(request.body)
    const user_id = request.user!.sub

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ success: false, error: { code: 'NO_UPDATES', message: 'No hay campos para actualizar' } })
    }

    const [updated] = await fastify.db`
      UPDATE users
      SET ${fastify.db(updates)}, updated_at = NOW()
      WHERE id = ${user_id}
      RETURNING id, email, name, surname, city, birth_year, plan, active_modules, interests
    `
    return reply.send({ success: true, data: updated })
  })

  // PATCH /users/me/modules
  fastify.patch('/me/modules', { preHandler: requireAuth }, async (request, reply) => {
    const body = request.body as any
    const user_id = request.user!.sub

    const active_modules = body.modules || body.active_modules || []
    const interests = body.interests || null
    const city = body.city || null

    const [updated] = await fastify.db`
      UPDATE users
      SET active_modules = ${active_modules},
          interests      = COALESCE(${interests}, interests),
          city           = COALESCE(${city}, city),
          updated_at     = NOW()
      WHERE id = ${user_id}
      RETURNING id, active_modules, interests, city
    `

    // Notificar al motor de alertas del cambio
    try {
      await fetch(`${process.env.ALERT_ENGINE_URL}/users/${user_id}/modules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Secret': process.env.ALERT_ENGINE_SECRET!,
        },
        body: JSON.stringify({ active_modules }),
      })
    } catch (err) {
      fastify.log.warn({ err }, 'No se pudo notificar al motor de alertas')
    }

    return reply.send({ success: true, data: updated })
  })

  // GET /users/me/preferences
  fastify.get('/me/preferences', { preHandler: requireAuth }, async (request, reply) => {
    const [prefs] = await fastify.db`
      SELECT * FROM user_preferences WHERE user_id = ${request.user!.sub} LIMIT 1
    `
    return reply.send({ success: true, data: prefs })
  })

  // PATCH /users/me/preferences
  fastify.patch('/me/preferences', { preHandler: requireAuth }, async (request, reply) => {
    const updates = UpdatePreferencesSchema.parse(request.body)
    const user_id = request.user!.sub

    const [updated] = await fastify.db`
      UPDATE user_preferences
      SET ${fastify.db(updates)}, updated_at = NOW()
      WHERE user_id = ${user_id}
      RETURNING *
    `
    return reply.send({ success: true, data: updated })
  })

  // GET /users/me/stats — estadísticas del dashboard
  fastify.get('/me/stats', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub

    const [alertStats] = await fastify.db`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','delivered')) as active_alerts,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) as alerts_this_month,
        COUNT(*) FILTER (WHERE status = 'acted' AND created_at >= DATE_TRUNC('month', NOW())) as acted_this_month
      FROM alerts WHERE user_id = ${user_id}
    `
    const [connStats] = await fastify.db`
      SELECT COUNT(*) as total_connections
      FROM social_connections
      WHERE (user_id_1 = ${user_id} OR user_id_2 = ${user_id}) AND status = 'accepted'
    `

    // Obtener ciudad del usuario para el tiempo
    const [userCity] = await fastify.db`SELECT city FROM users WHERE id = ${user_id} LIMIT 1`
    let weatherTemp = 0
    let weatherDesc = ''
    try {
      const apiKey = process.env.OPENWEATHER_API_KEY
      if (apiKey && userCity?.city) {
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(userCity.city)},ES&appid=${apiKey}&units=metric&lang=es`
        )
        if (res.ok) {
          const w = await res.json() as any
          weatherTemp = Math.round(w.main?.temp ?? 0)
          weatherDesc = w.weather?.[0]?.description ?? ''
        }
      }
    } catch { /* silencioso */ }

    return reply.send({
      success: true,
      data: {
        active_alerts:    Number(alertStats.active_alerts),
        alerts_this_month: Number(alertStats.alerts_this_month),
        acted_this_month: Number(alertStats.acted_this_month),
        connections:      Number(connStats.total_connections),
        weather_temp:     weatherTemp,
        weather_desc:     weatherDesc,
      },
    })
  })

  // DELETE /users/me — borrar cuenta (RGPD)
  fastify.delete('/me', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    // Anonimizar en lugar de borrar (RGPD art. 17)
    await fastify.db`
      UPDATE users
      SET email = ${'deleted_' + user_id + '@kairo.deleted'},
          name = 'Usuario eliminado',
          surname = '',
          password_hash = '',
          deleted_at = NOW(),
          updated_at = NOW()
      WHERE id = ${user_id}
    `
    await fastify.redis.del(`refresh:${user_id}`)
    return reply.send({ success: true, data: { message: 'Cuenta eliminada correctamente' } })
  })

  // POST /users/me/fcm-token — guardar token FCM del dispositivo
  fastify.post('/me/fcm-token', { preHandler: requireAuth }, async (request, reply) => {
    const { fcm_token } = request.body as { fcm_token: string }
    const user_id = request.user!.sub
    await fastify.db`
      UPDATE users SET fcm_token = ${fcm_token} WHERE id = ${user_id}
    `
    return reply.send({ success: true })
  })
}

export default usersRoutes
