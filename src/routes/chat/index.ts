import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../../middleware/auth.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MessageSchema = z.object({
  message: z.string().min(1).max(2000),
  conversation_history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(20).default([]),
})

// ── PROMPT DEL SISTEMA ─────────────────────────────────────────────────────────
function buildSystemPrompt(user: any, alerts: any[], stats: any): string {
  const activeModules = (user.active_modules || []).join(', ')
  const recentAlerts = alerts.slice(0, 5).map((a: any) =>
    `- [${a.rule_id}] ${a.title} (${a.module})`
  ).join('\n') || 'Sin alertas recientes'

  return `Eres Kairo, el asistente personal proactivo de ${user.name}.

Tu personalidad:
- Eres cálido, directo y empático. Hablas en español, de forma natural y cercana.
- No eres un chatbot genérico. Conoces a ${user.name} y tienes contexto real de su vida.
- Eres proactivo — anticipas lo que necesita antes de que lo pida.
- Eres conciso. Máximo 3-4 frases por respuesta salvo que el usuario pida más detalle.
- Nunca eres condescendiente ni das discursos. Vas al grano.

Contexto actual de ${user.name}:
- Plan: ${user.plan}
- Ciudad: ${user.city || 'Madrid'}
- Módulos activos: ${activeModules}
- Alertas activas este mes: ${stats?.active_alerts || 0}
- Conexiones sociales: ${stats?.connections || 0}

Alertas recientes:
${recentAlerts}

Límites irrenunciables:
1. NUNCA ejecutas transacciones financieras ni das asesoramiento de inversión (MiFID II).
2. Si detectas señales de crisis emocional severa o ideación autolesiva, SIEMPRE derivas a un profesional y proporcionas recursos de crisis (Teléfono de la Esperanza: 717 003 717).
3. No inventas datos que no tienes. Si no sabes algo, lo dices.
4. No eres médico, abogado ni asesor financiero certificado.

Hoy es ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`
}

// ── RUTAS ──────────────────────────────────────────────────────────────────────
const chatRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /chat/message
  fastify.post('/message', { preHandler: requireAuth }, async (request, reply) => {
    const { message, conversation_history } = MessageSchema.parse(request.body)
    const user_id = request.user!.sub

    // Obtener contexto del usuario
    const [user] = await fastify.db`
      SELECT u.id, u.name, u.plan, u.city, u.active_modules, u.interests,
             p.max_daily_alerts, p.checkin_enabled
      FROM users u
      LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = ${user_id} LIMIT 1
    `

    if (!user) {
      return reply.code(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' } })
    }

    // Obtener alertas recientes
    const alerts = await fastify.db`
      SELECT rule_id, title, module, type, status
      FROM alerts
      WHERE user_id = ${user_id}
        AND status IN ('pending', 'delivered', 'read')
      ORDER BY created_at DESC
      LIMIT 10
    `

    // Obtener stats
    const [stats] = await fastify.db`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','delivered')) as active_alerts,
        (SELECT COUNT(*) FROM social_connections
         WHERE (user_id_1 = ${user_id} OR user_id_2 = ${user_id})
           AND status = 'accepted') as connections
      FROM alerts WHERE user_id = ${user_id}
    `

    // Construir mensajes para Claude
    const messages: Anthropic.MessageParam[] = [
      ...conversation_history.map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: message },
    ]

    // Guardar mensaje del usuario en historial
    await fastify.db`
      INSERT INTO chat_messages (user_id, role, content)
      VALUES (${user_id}, 'user', ${message})
    `

    try {
      const response = await client.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 500,
        system: buildSystemPrompt(user, alerts, stats),
        messages,
      })

      const assistantMessage = response.content[0].type === 'text'
        ? response.content[0].text
        : 'Lo siento, no pude procesar tu mensaje.'

      // Guardar respuesta en historial
      await fastify.db`
        INSERT INTO chat_messages (user_id, role, content)
        VALUES (${user_id}, 'assistant', ${assistantMessage})
      `

      // Detectar señales de crisis (EMO-12 / EMO-13 — límite irrenunciable)
      const crisisKeywords = ['suicid', 'hacerme daño', 'no quiero vivir', 'quitarme la vida', 'autolesion']
      const hasCrisisSignal = crisisKeywords.some(kw =>
        message.toLowerCase().includes(kw)
      )

      return reply.send({
        success: true,
        data: {
          message: assistantMessage,
          crisis_resources: hasCrisisSignal ? {
            message: "Parece que estás pasando por un momento muy difícil. Por favor contacta con un profesional.",
            phone: "717 003 717",
            name: "Teléfono de la Esperanza",
          } : null,
          tokens_used: response.usage.input_tokens + response.usage.output_tokens,
        },
      })

    } catch (err: any) {
      fastify.log.error({ err }, 'Error llamando a Claude API: ' + JSON.stringify(err?.message || err?.status || err))

      if (err.status === 401) {
        return reply.code(500).send({
          success: false,
          error: { code: 'AI_CONFIG_ERROR', message: 'Error de configuración de IA' }
        })
      }

      return reply.code(500).send({
        success: false,
        error: { code: 'AI_ERROR', message: (err?.message || err?.error?.message || 'Error desconocido') }
      })
    }
  })

  // GET /chat/history — historial de conversación
  fastify.get('/history', { preHandler: requireAuth }, async (request, reply) => {
    const { limit = 20 } = request.query as { limit?: number }
    const messages = await fastify.db`
      SELECT role, content, created_at
      FROM chat_messages
      WHERE user_id = ${request.user!.sub}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return reply.send({ success: true, data: messages.reverse() })
  })
}

export default chatRoutes
