import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'

const AlertActionSchema = z.object({
  action_key: z.string(),
  payload: z.record(z.unknown()).optional(),
})

const SnoozeSchema = z.object({
  minutes: z.number().int().min(15).max(1440).default(60),
})

const alertRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /alerts — obtener alertas del usuario
  fastify.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const { status, module, limit = 20, page = 1 } = request.query as any
    const offset = (page - 1) * limit
    const user_id = request.user!.sub

    const conditions = [`a.user_id = ${user_id}`]
    if (status)  conditions.push(`a.status = '${status}'`)
    if (module)  conditions.push(`a.module = '${module}'`)

    const alerts = await fastify.db`
      SELECT a.*, 
             EXTRACT(EPOCH FROM (NOW() - a.created_at)) as age_seconds
      FROM alerts a
      WHERE a.user_id = ${user_id}
        ${status ? fastify.db`AND a.status = ${status}` : fastify.db``}
        ${module ? fastify.db`AND a.module = ${module}` : fastify.db``}
      ORDER BY a.priority ASC, a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ count }] = await fastify.db`
      SELECT COUNT(*) FROM alerts WHERE user_id = ${user_id}
        ${status ? fastify.db`AND status = ${status}` : fastify.db``}
    `

    return reply.send({
      success: true,
      data: alerts,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total: Number(count),
        total_pages: Math.ceil(Number(count) / limit),
      },
    })
  })

  // GET /alerts/:id — obtener una alerta
  fastify.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [alert] = await fastify.db`
      SELECT * FROM alerts
      WHERE id = ${id} AND user_id = ${request.user!.sub}
      LIMIT 1
    `
    if (!alert) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerta no encontrada' } })
    return reply.send({ success: true, data: alert })
  })

  // PATCH /alerts/:id/read — marcar como leída
  fastify.patch('/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const [updated] = await fastify.db`
      UPDATE alerts
      SET status = 'read', read_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND user_id = ${request.user!.sub}
        AND status = 'delivered'
      RETURNING *
    `
    if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerta no encontrada' } })
    return reply.send({ success: true, data: updated })
  })

  // POST /alerts/:id/action — ejecutar acción sobre una alerta
  fastify.post('/:id/action', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { action_key, payload } = AlertActionSchema.parse(request.body)

    const [alert] = await fastify.db`
      SELECT * FROM alerts WHERE id = ${id} AND user_id = ${request.user!.sub} LIMIT 1
    `
    if (!alert) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerta no encontrada' } })

    // Registrar feedback
    await fastify.db`
      INSERT INTO alert_feedback (alert_id, user_id, action_key, payload)
      VALUES (${id}, ${request.user!.sub}, ${action_key}, ${JSON.stringify(payload ?? {})})
    `

    // Marcar como actuada
    await fastify.db`
      UPDATE alerts SET status = 'acted', updated_at = NOW() WHERE id = ${id}
    `

    // Respuesta según acción
    const responses: Record<string, string> = {
      view_contract:  'Abriendo detalle del contrato...',
      view_expenses:  'Abriendo desglose de gastos...',
      open_checkin:   'Iniciando check-in emocional...',
      view_profile:   'Abriendo perfil de conexión...',
      snooze:         'Alerta pospuesta 1 hora',
      dismiss:        'Alerta descartada',
    }

    return reply.send({
      success: true,
      data: {
        action_key,
        message: responses[action_key] ?? 'Acción registrada',
        navigate_to: action_key.startsWith('view_') ? action_key.replace('view_', '/') : null,
      },
    })
  })

  // POST /alerts/:id/snooze — posponer alerta
  fastify.post('/:id/snooze', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { minutes } = SnoozeSchema.parse(request.body)

    const [updated] = await fastify.db`
      UPDATE alerts
      SET status = 'snoozed',
          scheduled_for = NOW() + (${minutes} || ' minutes')::interval,
          updated_at = NOW()
      WHERE id = ${id} AND user_id = ${request.user!.sub}
      RETURNING *
    `
    if (!updated) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Alerta no encontrada' } })

    return reply.send({
      success: true,
      data: { message: `Alerta pospuesta ${minutes} minutos`, scheduled_for: updated.scheduled_for },
    })
  })

  // DELETE /alerts/:id — descartar alerta
  fastify.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await fastify.db`
      UPDATE alerts SET status = 'dismissed', updated_at = NOW()
      WHERE id = ${id} AND user_id = ${request.user!.sub}
    `
    return reply.send({ success: true, data: { message: 'Alerta descartada' } })
  })

  // GET /alerts/stats — estadísticas de alertas del mes
  fastify.get('/stats', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const [stats] = await fastify.db`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) as total_month,
        COUNT(*) FILTER (WHERE status = 'pending' OR status = 'delivered') as pending,
        COUNT(*) FILTER (WHERE status = 'acted') as acted,
        COUNT(*) FILTER (WHERE status = 'dismissed') as dismissed,
        COUNT(*) FILTER (WHERE module = 'financial') as financial,
        COUNT(*) FILTER (WHERE module = 'legal') as legal,
        COUNT(*) FILTER (WHERE module = 'emotional') as emotional,
        COUNT(*) FILTER (WHERE module = 'sport') as sport,
        COUNT(*) FILTER (WHERE module = 'social') as social
      FROM alerts
      WHERE user_id = ${user_id}
    `
    return reply.send({ success: true, data: stats })
  })
}

export default alertRoutes
