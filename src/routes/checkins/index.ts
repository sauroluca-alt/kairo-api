import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'

const CreateCheckinSchema = z.object({
  mood:   z.number().int().min(1).max(5),
  energy: z.number().int().min(1).max(5),
  stress: z.number().int().min(1).max(5),
  notes:  z.string().max(500).optional().default(''),
})

// Genera un comentario de Kairo basado en los valores del check-in
function buildKairoComment(mood: number, energy: number, stress: number, notes: string): string {
  if (mood >= 4 && energy >= 4 && stress <= 2) {
    return '¡Gran estado hoy! Tu energía y ánimo están en su punto. Aprovéchalo.'
  }
  if (stress >= 4) {
    if (energy <= 2) return 'Estrés alto y energía baja — señal de que necesitas parar. Intenta descansar esta tarde.'
    return 'Estrés elevado. Recuerda respirar y priorizar lo esencial. Llevas bien el ritmo.'
  }
  if (mood <= 2 && energy <= 2) {
    return 'Día difícil. Está bien no estar al 100%. ¿Has podido descansar?'
  }
  if (mood <= 2) {
    return 'El ánimo está bajo pero tienes energía. A veces solo hace falta un pequeño empujón.'
  }
  if (energy <= 2) {
    return 'Energía baja hoy. Considera una pausa activa o un descanso corto.'
  }
  if (mood === 3 && energy === 3 && stress === 3) {
    return 'Día equilibrado. Sin picos ni bajones. A veces la estabilidad es lo mejor.'
  }
  return 'Check-in recibido. Sigo atento a cómo evoluciona tu semana.'
}

const checkinsRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /checkins — guardar un nuevo check-in
  fastify.post('/', { preHandler: requireAuth }, async (request, reply) => {
    const { mood, energy, stress, notes } = CreateCheckinSchema.parse(request.body)
    const user_id = request.user!.sub

    // Verificar si ya hizo check-in hoy
    const [existing] = await fastify.db`
      SELECT id FROM mood_checkins
      WHERE user_id = ${user_id}
        AND created_at >= DATE_TRUNC('day', NOW())
      LIMIT 1
    `

    if (existing) {
      // Actualizar el check-in del día
      const [updated] = await fastify.db`
        UPDATE mood_checkins
        SET mood = ${mood}, energy = ${energy}, stress = ${stress},
            notes = ${notes}, created_at = NOW()
        WHERE id = ${existing.id}
        RETURNING *
      `
      const kairo_comment = buildKairoComment(mood, energy, stress, notes)
      return reply.send({
        success: true,
        data: { ...updated, kairo_comment, updated: true },
      })
    }

    // Insertar nuevo check-in
    const [checkin] = await fastify.db`
      INSERT INTO mood_checkins (user_id, mood, energy, stress, notes)
      VALUES (${user_id}, ${mood}, ${energy}, ${stress}, ${notes})
      RETURNING *
    `

    const kairo_comment = buildKairoComment(mood, energy, stress, notes)

    return reply.code(201).send({
      success: true,
      data: { ...checkin, kairo_comment, updated: false },
    })
  })

  // GET /checkins — historial de check-ins del usuario
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const { limit = 30, page = 1 } = request.query as { limit?: number; page?: number }
    const offset = (Number(page) - 1) * Number(limit)
    const user_id = request.user!.sub

    const checkins = await fastify.db`
      SELECT id, mood, energy, stress, notes, created_at
      FROM mood_checkins
      WHERE user_id = ${user_id}
      ORDER BY created_at DESC
      LIMIT ${Number(limit)} OFFSET ${offset}
    `

    const [{ count }] = await fastify.db`
      SELECT COUNT(*) FROM mood_checkins WHERE user_id = ${user_id}
    `

    // Calcular promedios de la última semana
    const [weekStats] = await fastify.db`
      SELECT
        ROUND(AVG(mood)::numeric, 1)   as avg_mood,
        ROUND(AVG(energy)::numeric, 1) as avg_energy,
        ROUND(AVG(stress)::numeric, 1) as avg_stress,
        COUNT(*) as total_week
      FROM mood_checkins
      WHERE user_id = ${user_id}
        AND created_at >= NOW() - INTERVAL '7 days'
    `

    // Calcular racha actual (días consecutivos con check-in, empezando desde ayer si hoy no hay)
    const recentDates = await fastify.db`
      SELECT DISTINCT DATE(created_at AT TIME ZONE 'Europe/Madrid') as day
      FROM mood_checkins
      WHERE user_id = ${user_id}
      ORDER BY day DESC
      LIMIT 30
    `

    let streak = 0
    if (recentDates.length > 0) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)

      const lastCheckinDate = new Date(recentDates[0].day)
      lastCheckinDate.setHours(0, 0, 0, 0)

      // Si el último check-in es hoy o ayer, empezamos a contar
      const isToday     = lastCheckinDate.getTime() === today.getTime()
      const isYesterday = lastCheckinDate.getTime() === yesterday.getTime()

      if (isToday || isYesterday) {
        for (let i = 0; i < recentDates.length; i++) {
          const expectedDate = new Date(today)
          expectedDate.setDate(today.getDate() - (isToday ? i : i + 1))
          const checkinDate = new Date(recentDates[i].day)
          checkinDate.setHours(0, 0, 0, 0)
          if (expectedDate.getTime() === checkinDate.getTime()) {
            streak++
          } else {
            break
          }
        }
      }
    }

    return reply.send({
      success: true,
      data: checkins,
      meta: {
        page:        Number(page),
        limit:       Number(limit),
        total:       Number(count),
        total_pages: Math.ceil(Number(count) / Number(limit)),
        week_stats: {
          avg_mood:    Number(weekStats?.avg_mood)   || 0,
          avg_energy:  Number(weekStats?.avg_energy) || 0,
          avg_stress:  Number(weekStats?.avg_stress) || 0,
          total:       Number(weekStats?.total_week) || 0,
          streak,
        },
      },
    })
  })

  // GET /checkins/today — check-in de hoy (si existe)
  fastify.get('/today', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const [checkin] = await fastify.db`
      SELECT * FROM mood_checkins
      WHERE user_id = ${user_id}
        AND created_at >= DATE_TRUNC('day', NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `
    return reply.send({
      success: true,
      data: checkin || null,
    })
  })
}

export default checkinsRoutes
