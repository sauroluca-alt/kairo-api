import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.js'

const socialRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /social/suggestions — sugerencias de conexión basadas en intereses
  fastify.get('/suggestions', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub

    // Obtener intereses del usuario actual
    const [me] = await fastify.db`
      SELECT interests, city FROM users WHERE id = ${user_id}
    `

    // Buscar usuarios con intereses en común, excluir ya conectados
    const connectedIds = await fastify.db`
      SELECT CASE
        WHEN user_id_1 = ${user_id} THEN user_id_2
        ELSE user_id_1
      END AS other_id
      FROM social_connections
      WHERE (user_id_1 = ${user_id} OR user_id_2 = ${user_id})
        AND status IN ('accepted','pending')
    `
    const excludeIds = [user_id, ...connectedIds.map((r: any) => r.other_id)]

    const candidates = await fastify.db`
      SELECT id, name, surname, city,
             EXTRACT(YEAR FROM AGE(NOW(), DATE(birth_year::text || '-01-01')))::int AS age,
             interests,
             last_login
      FROM users
      WHERE id != ALL(${excludeIds}::uuid[])
        AND deleted_at IS NULL
        AND last_login > NOW() - INTERVAL '30 days'
      LIMIT 20
    `

    // Calcular match score por intereses en común
    const myInterests: string[] = me?.interests || []
    const suggestions = candidates.map((u: any) => {
      const theirInterests: string[] = u.interests || []
      const common = theirInterests.filter((i: string) =>
        myInterests.some(mi => mi.toLowerCase() === i.toLowerCase())
      )
      const matchScore = Math.min(99, 60 + common.length * 12)
      const initials = `${u.name?.[0] || '?'}${u.surname?.[0] || ''}`.toUpperCase()
      const lastActive = formatLastActive(u.last_login)

      return {
        id:          u.id,
        initials,
        name:        `${u.name} ${u.surname}`.trim(),
        age:         u.age || 30,
        city:        u.city || 'Madrid',
        interests:   theirInterests.slice(0, 3),
        match_score: matchScore,
        last_active: lastActive,
      }
    })
    .filter((u: any) => u.match_score >= 60)
    .sort((a: any, b: any) => b.match_score - a.match_score)
    .slice(0, 6)

    return reply.send({ success: true, data: suggestions })
  })

  // GET /social/connections — conexiones aceptadas del usuario
  fastify.get('/connections', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub

    const connections = await fastify.db`
      SELECT
        sc.id, sc.status, sc.match_score, sc.created_at,
        u.id AS other_id, u.name, u.surname, u.city, u.interests, u.last_login
      FROM social_connections sc
      JOIN users u ON u.id = CASE
        WHEN sc.user_id_1 = ${user_id} THEN sc.user_id_2
        ELSE sc.user_id_1
      END
      WHERE (sc.user_id_1 = ${user_id} OR sc.user_id_2 = ${user_id})
        AND sc.status = 'accepted'
      ORDER BY sc.updated_at DESC
    `

    return reply.send({
      success: true,
      data: connections.map((c: any) => ({
        id:          c.other_id,
        name:        `${c.name} ${c.surname}`.trim(),
        initials:    `${c.name?.[0] || ''}${c.surname?.[0] || ''}`.toUpperCase(),
        city:        c.city,
        interests:   (c.interests || []).slice(0, 3),
        match_score: c.match_score || 75,
        last_active: formatLastActive(c.last_login),
        status:      c.status,
      }))
    })
  })

  // POST /social/connect/:id — enviar solicitud de conexión
  fastify.post('/connect/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id: target_id } = request.params as { id: string }
    const user_id = request.user!.sub

    if (user_id === target_id) {
      return reply.code(400).send({ success: false, error: 'Cannot connect with yourself' })
    }

    const [existing] = await fastify.db`
      SELECT id, status FROM social_connections
      WHERE (user_id_1 = ${user_id} AND user_id_2 = ${target_id})
         OR (user_id_1 = ${target_id} AND user_id_2 = ${user_id})
    `

    if (existing) {
      return reply.send({ success: true, data: existing, already_exists: true })
    }

    const [conn] = await fastify.db`
      INSERT INTO social_connections (user_id_1, user_id_2, status, match_score)
      VALUES (${user_id}, ${target_id}, 'pending', 80)
      RETURNING *
    `

    return reply.code(201).send({ success: true, data: conn })
  })
}

function formatLastActive(lastLogin: Date | string | null): string {
  if (!lastLogin) return 'hace tiempo'
  const d = new Date(lastLogin)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  return `hace ${days}d`
}

export default socialRoutes
