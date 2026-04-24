import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'

const EventSchema = z.object({
  title:     z.string().min(1).max(200),
  time:      z.string().default('Todo el día'),
  end_time:  z.string().optional().default(''),
  category:  z.enum(['WORK','SPORT','HEALTH','FAMILY','SOCIAL','FINANCE']).default('WORK'),
  event_date: z.string(), // YYYY-MM-DD
  is_kairo:  z.boolean().default(false),
})

const calendarRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /calendar/events?month=4&year=2026
  fastify.get('/events', { preHandler: requireAuth }, async (request, reply) => {
    const { month, year } = request.query as { month?: number; year?: number }
    const user_id = request.user!.sub

    const now = new Date()
    const m = Number(month) || (now.getMonth() + 1)
    const y = Number(year)  || now.getFullYear()

    const events = await fastify.db`
      SELECT id, title, time, end_time, category, event_date, is_kairo, created_at
      FROM calendar_events
      WHERE user_id = ${user_id}
        AND EXTRACT(MONTH FROM event_date) = ${m}
        AND EXTRACT(YEAR  FROM event_date) = ${y}
      ORDER BY event_date ASC, time ASC
    `

    return reply.send({
      success: true,
      data: events.map((e: any) => ({
        id:         e.id,
        title:      e.title,
        time:       e.time      || 'Todo el día',
        end_time:   e.end_time  || '',
        category:   e.category  || 'WORK',
        day:        new Date(e.event_date).getUTCDate(),
        month:      new Date(e.event_date).getUTCMonth() + 1,
        year:       new Date(e.event_date).getUTCFullYear(),
        is_kairo:   e.is_kairo  || false,
      }))
    })
  })

  // POST /calendar/events
  fastify.post('/events', { preHandler: requireAuth }, async (request, reply) => {
    const { title, time, end_time, category, event_date, is_kairo } = EventSchema.parse(request.body)
    const user_id = request.user!.sub

    const [event] = await fastify.db`
      INSERT INTO calendar_events (user_id, title, time, end_time, category, event_date, is_kairo)
      VALUES (${user_id}, ${title}, ${time}, ${end_time}, ${category}, ${event_date}, ${is_kairo})
      RETURNING *
    `

    return reply.code(201).send({ success: true, data: event })
  })

  // DELETE /calendar/events/:id
  fastify.delete('/events/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const user_id = request.user!.sub

    await fastify.db`
      DELETE FROM calendar_events WHERE id = ${id} AND user_id = ${user_id}
    `

    return reply.send({ success: true })
  })
}

export default calendarRoutes
