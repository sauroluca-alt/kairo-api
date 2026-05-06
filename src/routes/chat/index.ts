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

GESTIÓN DE INTERESES: Si el usuario pide eliminar intereses (artistas, equipos, géneros musicales), responde que lo has hecho. Si pide añadir intereses, responde que los has guardado. En ambos casos incluye al final de tu respuesta exactamente esta línea (sin mostrarla al usuario como texto):
KAIRO_ACTION:{"type":"update_interests","add":[],"remove":[]}
Rellena add y remove con los valores mencionados en minúsculas. Ejemplo: KAIRO_ACTION:{"type":"update_interests","add":["techno","house"],"remove":["rosalia"]}

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

      const rawMessage = response.content[0].type === 'text'
        ? response.content[0].text : 'Lo siento, no pude procesar tu mensaje.'

      // Procesar KAIRO_ACTION si existe
      let assistantMessage = rawMessage
      const actionMatch = rawMessage.match(/KAIRO_ACTION:(\{[^}]+\})/)
      if (actionMatch) {
        try {
          const action = JSON.parse(actionMatch[1])
          assistantMessage = rawMessage.replace(/KAIRO_ACTION:[^\n]+/g, '').trim()
          if (action.type === 'update_interests') {
            if (action.remove?.length > 0) {
              for (const val of action.remove) {
                await fastify.db`DELETE FROM user_detected_interests WHERE user_id = ${user_id} AND interest_value ILIKE ${'%' + val + '%'}`
              }
            }
            if (action.add?.length > 0) {
              for (const val of action.add) {
                const type = ['techno','house','electro','edm','trance','reggaeton','trap','jazz','rock','pop','metal','flamenco','electronica','festival'].some(g => val.includes(g)) ? 'music_genre' : 'music_artist'
                await fastify.db`INSERT INTO user_detected_interests (user_id, interest_type, interest_value, detected_at, confidence, detection_count) VALUES (${user_id}, ${type}, ${val}, NOW(), 0.9, 1) ON CONFLICT (user_id, interest_type, interest_value) DO UPDATE SET confidence = 0.9, detected_at = NOW()`
              }
            }
          }
        } catch (e) { fastify.log.warn('Error KAIRO_ACTION:', e) }
      }

      await fastify.db`INSERT INTO chat_messages (user_id, role, content) VALUES (${user_id}, 'assistant', ${assistantMessage})`

      // Extraer intereses de forma asíncrona (no bloquea la respuesta)
      extractAndSaveInterests(fastify, user_id, message, assistantMessage).catch(() => {})

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

  // GET /chat/interests — intereses detectados del usuario
  fastify.get('/interests', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const interests = await fastify.db`
      SELECT interest_type, interest_value, confidence, detection_count, detected_at
      FROM user_detected_interests
      WHERE user_id = ${user_id}
      ORDER BY confidence DESC, detection_count DESC
    `
    return reply.send({ success: true, data: interests })
  })
}

export default chatRoutes

// ── EXTRACTOR DE INTERESES ─────────────────────────────────────────────────────
async function extractAndSaveInterests(
  fastify: any,
  user_id: string,
  message: string,
  response: string
): Promise<void> {
  try {
    // Patrones para detectar intereses en el mensaje del usuario
    const footballTeams = [
      'atlético', 'atletico', 'atleti', 'real madrid', 'madrid', 'barcelona', 'barça', 'barca',
      'sevilla', 'valencia', 'betis', 'villarreal', 'athletic', 'bilbao', 'sociedad',
      'juventus', 'milan', 'inter', 'napoli', 'roma', 'arsenal', 'chelsea', 'liverpool',
      'manchester', 'city', 'united', 'psg', 'bayern', 'dortmund'
    ]

    const musicArtists = [
      'rosalía', 'rosalia', 'bad bunny', 'j balvin', 'shakira', 'alejandro sanz',
      'coldplay', 'taylor swift', 'beyoncé', 'beyonce', 'drake', 'rihanna',
      'maluma', 'ozuna', 'anuel', 'karol g', 'rauw alejandro', 'myke towers',
      'guns n roses', 'metallica', 'u2', 'radiohead', 'arctic monkeys',
      'dua lipa', 'the weeknd', 'harry styles', 'billie eilish', 'olivia rodrigo',
      'david guetta', 'calvin harris', 'tiesto', 'martin garrix', 'hardwell',
      'flume', 'disclosure', 'bicep', 'boiler room', 'aphex twin'
    ]

    const musicGenres = [
      'techno', 'house', 'electrónica', 'electronica', 'edm', 'trance', 'ambient',
      'reggaeton', 'trap', 'hiphop', 'hip hop', 'rap', 'jazz', 'blues', 'soul',
      'rock', 'metal', 'punk', 'indie', 'pop', 'flamenco', 'salsa', 'cumbia',
      'drum and bass', 'dnb', 'dubstep', 'techhouse', 'tech house', 'minimal',
      'festival', 'festivales', 'concierto', 'conciertos'
    ]

    // Normalizar texto eliminando acentos para mejor matching
    const normalize = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    
    const combined = normalize(message + ' ' + response)
    const detected: { type: string; value: string }[] = []

    footballTeams.forEach(team => {
      if (combined.includes(normalize(team))) {
        detected.push({ type: 'football_team', value: team })
      }
    })

    musicArtists.forEach(artist => {
      if (combined.includes(normalize(artist))) {
        detected.push({ type: 'music_artist', value: artist })
      }
    })

    musicGenres.forEach(genre => {
      if (combined.includes(normalize(genre))) {
        detected.push({ type: 'music_genre', value: genre })
      }
    })

    if (detected.length === 0) return

    // Guardar intereses detectados
    for (const interest of detected) {
      await fastify.db`
        INSERT INTO user_detected_interests (user_id, interest_type, interest_value, detected_at, confidence)
        VALUES (${user_id}, ${interest.type}, ${interest.value}, NOW(), 0.8)
        ON CONFLICT (user_id, interest_type, interest_value)
        DO UPDATE SET
          detected_at = NOW(),
          confidence = LEAST(user_detected_interests.confidence + 0.1, 1.0),
          detection_count = user_detected_interests.detection_count + 1
      `
    }

    fastify.log.info({ user_id, detected }, 'Intereses detectados y guardados')
  } catch (err) {
    fastify.log.warn({ err }, 'Error extrayendo intereses')
  }
}
