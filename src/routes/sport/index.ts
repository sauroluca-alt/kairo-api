import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'

const WorkoutSchema = z.object({
  type:      z.string().min(1).max(50),
  duration:  z.number().int().positive(),   // minutos
  calories:  z.number().int().min(0),
  distance:  z.number().min(0).optional(),  // km
  notes:     z.string().max(300).optional().default(''),
  worked_at: z.string().optional(),         // ISO date, default NOW
})

const sportRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /sport/stats — stats del usuario para hoy y esta semana
  fastify.get('/stats', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub

    // Entrenos de esta semana
    const [weekStats] = await fastify.db`
      SELECT
        COUNT(*)                          AS workouts_week,
        COALESCE(SUM(calories), 0)        AS calories_week,
        COALESCE(SUM(duration), 0)        AS active_minutes_week
      FROM sport_workouts
      WHERE user_id = ${user_id}
        AND worked_at >= DATE_TRUNC('week', NOW())
    `

    // Pasos de hoy (de sport_daily_stats si existe)
    const [todayStats] = await fastify.db`
      SELECT steps, calories_burned, sleep_hours, heart_rate_resting
      FROM sport_daily_stats
      WHERE user_id = ${user_id}
        AND stat_date = CURRENT_DATE
      LIMIT 1
    `.catch(() => [null])

    // Último entreno
    const [lastWorkout] = await fastify.db`
      SELECT type, duration, calories, distance, worked_at
      FROM sport_workouts
      WHERE user_id = ${user_id}
      ORDER BY worked_at DESC
      LIMIT 1
    `

    return reply.send({
      success: true,
      data: {
        steps_today:          todayStats?.steps              ?? 0,
        steps_goal:           10000,
        calories_week:        Number(weekStats?.calories_week) || 0,
        active_minutes_week:  Number(weekStats?.active_minutes_week) || 0,
        workouts_week:        Number(weekStats?.workouts_week) || 0,
        workouts_goal:        5,
        heart_rate_resting:   todayStats?.heart_rate_resting ?? 0,
        sleep_hours_last:     todayStats?.sleep_hours        ?? 0,
        last_workout: lastWorkout ? {
          type:     lastWorkout.type,
          duration: lastWorkout.duration,
          calories: lastWorkout.calories,
          distance: lastWorkout.distance,
          worked_at: lastWorkout.worked_at,
        } : null,
      },
    })
  })

  // GET /sport/workouts — historial de entrenos
  fastify.get('/workouts', { preHandler: requireAuth }, async (request, reply) => {
    const { limit = 20 } = request.query as { limit?: number }
    const user_id = request.user!.sub

    const workouts = await fastify.db`
      SELECT id, type, duration, calories, distance, notes, worked_at
      FROM sport_workouts
      WHERE user_id = ${user_id}
      ORDER BY worked_at DESC
      LIMIT ${Number(limit)}
    `

    return reply.send({
      success: true,
      data: workouts.map((w: any) => ({
        id:       w.id,
        type:     w.type,
        duration: w.duration,
        calories: w.calories,
        distance: w.distance ? Number(w.distance) : null,
        notes:    w.notes,
        worked_at: w.worked_at,
      }))
    })
  })

  // POST /sport/workouts — registrar un entreno
  fastify.post('/workouts', { preHandler: requireAuth }, async (request, reply) => {
    const { type, duration, calories, distance, notes, worked_at } = WorkoutSchema.parse(request.body)
    const user_id = request.user!.sub

    const [workout] = await fastify.db`
      INSERT INTO sport_workouts (user_id, type, duration, calories, distance, notes, worked_at)
      VALUES (${user_id}, ${type}, ${duration}, ${calories},
              ${distance ?? null}, ${notes}, ${worked_at ? new Date(worked_at) : new Date()})
      RETURNING *
    `

    return reply.code(201).send({ success: true, data: workout })
  })

  // POST /sport/steps — registrar pasos del día (desde Health Connect)
  fastify.post('/steps', { preHandler: requireAuth }, async (request, reply) => {
    const { steps, calories_burned, sleep_hours, heart_rate_resting } = request.body as {
      steps: number; calories_burned?: number; sleep_hours?: number; heart_rate_resting?: number
    }
    const user_id = request.user!.sub

    const [stat] = await fastify.db`
      INSERT INTO sport_daily_stats (user_id, stat_date, steps, calories_burned, sleep_hours, heart_rate_resting)
      VALUES (${user_id}, CURRENT_DATE, ${steps}, ${calories_burned ?? null},
              ${sleep_hours ?? null}, ${heart_rate_resting ?? null})
      ON CONFLICT (user_id, stat_date)
      DO UPDATE SET
        steps              = EXCLUDED.steps,
        calories_burned    = COALESCE(EXCLUDED.calories_burned, sport_daily_stats.calories_burned),
        sleep_hours        = COALESCE(EXCLUDED.sleep_hours, sport_daily_stats.sleep_hours),
        heart_rate_resting = COALESCE(EXCLUDED.heart_rate_resting, sport_daily_stats.heart_rate_resting)
      RETURNING *
    `

    return reply.send({ success: true, data: stat })
  })
}

export default sportRoutes
