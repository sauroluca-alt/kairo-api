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

// ── API DEL TIEMPO ─────────────────────────────────────────────────────────────
async function getWeather(city: string): Promise<string> {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (!apiKey) return ''
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)},ES&appid=${apiKey}&units=metric&lang=es`
    )
    if (!res.ok) return ''
    const data = await res.json() as any
    const temp   = Math.round(data.main?.temp ?? 0)
    const feels  = Math.round(data.main?.feels_like ?? 0)
    const desc   = data.weather?.[0]?.description ?? ''
    const wind   = Math.round((data.wind?.speed ?? 0) * 3.6)
    return `${temp}°C (sensación ${feels}°C), ${desc}, viento ${wind} km/h en ${city}.`
  } catch { return '' }
}

// ── SYSTEM PROMPT ──────────────────────────────────────────────────────────────
function buildSystemPrompt(
  user: any, alerts: any[], stats: any, todayEvents: any[],
  sport: any, checkin: any, finance: any, weather: string
): string {
  const today = new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const alertsText = alerts.length > 0
    ? alerts.map((a: any) => `${a.type === 'urgent' ? '⚠️' : '-'} [${a.rule_id}] ${a.title}`).join('\n')
    : 'Sin alertas activas'

  const eventsText = todayEvents.length > 0
    ? todayEvents.map((e: any) => `- ${e.time !== 'Todo el día' ? e.time + ': ' : ''}${e.title}`).join('\n')
    : 'Sin eventos hoy'

  const stepsText = sport
    ? `${Number(sport.steps_today).toLocaleString('es-ES')} pasos (objetivo 10.000), ${sport.workouts_week}/${sport.workouts_goal} entrenos esta semana`
    : 'Sin datos'

  const checkinText = checkin
    ? `Ánimo ${checkin.mood}/5, energía ${checkin.energy}/5, estrés ${checkin.stress}/5${checkin.notes ? ` — "${checkin.notes}"` : ''}`
    : 'Sin check-in hoy'

  const financeText = finance
    ? `Balance ${Number(finance.net_savings) > 0 ? '+' : ''}${Math.round(Number(finance.net_savings))}€ este mes (ingresos ${Math.round(Number(finance.total_income))}€, gastos ${Math.round(Number(finance.total_expenses))}€)`
    : 'Sin datos'

  return `Eres Kairo, el ángel personal de ${user.name}.

Personalidad: cálido, directo, empático. Español natural, tuteo siempre. Conciso (máx 3-4 frases). Nunca condescendiente. Cuando tienes datos reales, los usas sin decir "según tus datos" — habla como si lo supieras de forma natural.

HOY: ${today}
${weather ? `\nTIEMPO: ${weather}` : ''}
AGENDA HOY:
${eventsText}

ESTADO FÍSICO: ${stepsText}
ESTADO EMOCIONAL: ${checkinText}
FINANZAS: ${financeText}

ALERTAS (${stats?.active_alerts || 0} activas):
${alertsText}

PERFIL: ${user.city || 'Madrid'} · Plan ${user.plan} · Intereses: ${(user.interests || []).join(', ') || 'no especificados'}

LÍMITES: No ejecutas transacciones. No asesoras inversiones (MiFID II). No eres médico ni abogado. En crisis severa → Teléfono de la Esperanza 717 003 717.`
}

// ── RUTAS ──────────────────────────────────────────────────────────────────────
const chatRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post('/message', { preHandler: requireAuth }, async (request, reply) => {
    const { message, conversation_history } = MessageSchema.parse(request.body)
    const user_id = request.user!.sub

    const [userRows, alerts, statsRows, todayEvents, sportRows, checkinRows, financeRows] = await Promise.all([
      fastify.db`
        SELECT u.id, u.name, u.plan, u.city, u.active_modules, u.interests
        FROM users u WHERE u.id = ${user_id} LIMIT 1
      `,
      fastify.db`
        SELECT rule_id, title, module, type FROM alerts
        WHERE user_id = ${user_id} AND status IN ('pending','delivered','read')
        ORDER BY priority ASC, created_at DESC LIMIT 8
      `,
      fastify.db`
        SELECT COUNT(*) FILTER (WHERE status IN ('pending','delivered')) as active_alerts
        FROM alerts WHERE user_id = ${user_id}
      `,
      fastify.db`
        SELECT title, time, category FROM calendar_events
        WHERE user_id = ${user_id} AND event_date = CURRENT_DATE ORDER BY time ASC
      `,
      fastify.db`
        SELECT
          COALESCE((SELECT steps FROM sport_daily_stats WHERE user_id = ${user_id} AND stat_date = CURRENT_DATE), 0) as steps_today,
          (SELECT COUNT(*) FROM sport_workouts WHERE user_id = ${user_id} AND worked_at >= DATE_TRUNC('week', NOW())) as workouts_week,
          5 as workouts_goal
      `.catch(() => [null]),
      fastify.db`
        SELECT mood, energy, stress, notes FROM mood_checkins
        WHERE user_id = ${user_id} AND created_at >= DATE_TRUNC('day', NOW())
        ORDER BY created_at DESC LIMIT 1
      `.catch(() => [null]),
      fastify.db`
        SELECT
          COALESCE(SUM(CASE WHEN tx_type='credit' THEN amount ELSE 0 END),0) as total_income,
          COALESCE(SUM(CASE WHEN tx_type='debit'  THEN amount ELSE 0 END),0) as total_expenses,
          COALESCE(SUM(CASE WHEN tx_type='credit' THEN amount ELSE 0 END),0) -
          COALESCE(SUM(CASE WHEN tx_type='debit'  THEN amount ELSE 0 END),0) as net_savings
        FROM financial_transactions t
        JOIN financial_accounts a ON t.account_id = a.id
        WHERE t.user_id = ${user_id} AND DATE_TRUNC('month', tx_date) = DATE_TRUNC('month', CURRENT_DATE)
      `.catch(() => [null]),
    ])

    const user = userRows[0]
    if (!user) return reply.code(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' } })

    const weatherText = await getWeather(user.city || 'Madrid')

    const systemPrompt = buildSystemPrompt(
      user, alerts, statsRows[0], todayEvents,
      sportRows[0] || null, checkinRows[0] || null, financeRows[0] || null, weatherText
    )

    const claudeMessages: Anthropic.MessageParam[] = [
      ...conversation_history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: message },
    ]

    await fastify.db`INSERT INTO chat_messages (user_id, role, content) VALUES (${user_id}, 'user', ${message})`

    try {
      const response = await client.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: claudeMessages,
      })

      const assistantMessage = response.content[0].type === 'text'
        ? response.content[0].text : 'Lo siento, no pude procesar tu mensaje.'

      await fastify.db`INSERT INTO chat_messages (user_id, role, content) VALUES (${user_id}, 'assistant', ${assistantMessage})`

      const crisisKeywords = ['suicid', 'hacerme daño', 'no quiero vivir', 'quitarme la vida', 'autolesion']
      const hasCrisisSignal = crisisKeywords.some(kw => message.toLowerCase().includes(kw))

      return reply.send({
        success: true,
        data: {
          message: assistantMessage,
          crisis_resources: hasCrisisSignal ? { message: 'Parece que estás pasando por un momento muy difícil. Por favor contacta con un profesional.', phone: '717 003 717', name: 'Teléfono de la Esperanza' } : null,
          tokens_used: response.usage.input_tokens + response.usage.output_tokens,
        },
      })
    } catch (err: any) {
      fastify.log.error({ err }, 'Error Claude API')
      return reply.code(500).send({ success: false, error: { code: 'AI_ERROR', message: err?.message || 'Error desconocido' } })
    }
  })

  fastify.get('/history', { preHandler: requireAuth }, async (request, reply) => {
    const { limit = 20 } = request.query as { limit?: number }
    const messages = await fastify.db`
      SELECT role, content, created_at FROM chat_messages
      WHERE user_id = ${request.user!.sub}
      ORDER BY created_at DESC LIMIT ${limit}
    `
    return reply.send({ success: true, data: messages.reverse() })
  })
}

export default chatRoutes
