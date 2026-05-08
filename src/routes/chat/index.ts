import type { FastifyPluginAsync } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../../middleware/auth.js'
import { z } from 'zod'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MessageSchema = z.object({
  message: z.string().min(1).max(2000),
  conversation_history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional().default([])
})

// ── WEATHER ────────────────────────────────────────────────────────────────────
async function getWeather(city: string): Promise<string> {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY
    if (!apiKey) return ''
    const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=es`)
    if (!res.ok) return ''
    const data = await res.json() as any
    return `${Math.round(data.main.temp)}°C, ${data.weather[0].description}`
  } catch { return '' }
}

// ── SYSTEM PROMPT ──────────────────────────────────────────────────────────────
function buildSystemPrompt(user: any, weather: string, eventsText: string, stepsText: string, checkinText: string, financeText: string, alertsText: string, sportPlan: any, nutritionPlan: any, today: string): string {

  // Construir contexto del plan deportivo
  let sportContext = 'Sin plan deportivo configurado.'
  if (sportPlan) {
    const todayDayName = new Date().toLocaleDateString('es-ES', { weekday: 'long' }).toLowerCase()
    const todayWorkout = sportPlan.weekly_structure?.find((d: any) =>
      d.day?.toLowerCase().includes(todayDayName.slice(0, 3))
    )
    sportContext = `Plan: ${sportPlan.title || 'Plan activo'} | `
    if (todayWorkout) {
      sportContext += `HOY toca: ${todayWorkout.type} (${todayWorkout.duration}) - ${todayWorkout.focus}. Ejercicios: ${todayWorkout.exercises?.slice(0,3).map((e: any) => e.name).join(', ')}`
    } else {
      sportContext += `Hoy es día de descanso según el plan.`
    }
  }

  // Construir contexto del plan nutricional
  let nutritionContext = 'Sin plan nutricional configurado.'
  if (nutritionPlan) {
    const hour = new Date().getHours()
    // Pasar TODAS las comidas con sus nombres y horas
    const allMeals = nutritionPlan.meals?.map((m: any) =>
      `${m.name}(${m.time || '?'}, ${m.calories || 0}kcal): ${m.description?.slice(0, 50) || ''}`
    ).join(' | ') || ''
    const nextMeal = nutritionPlan.meals?.find((m: any) => {
      const mealHour = parseInt(m.time?.split(':')[0] || '0')
      return mealHour > hour
    }) || nutritionPlan.meals?.[0]
    nutritionContext = `${nutritionPlan.daily_calories || 0}kcal/día. COMIDAS: ${allMeals}. Próxima: ${nextMeal?.name || '?'} a las ${nextMeal?.time || '?'}. Nota: "almuerzo", "comida del mediodía" y "comida" son lo mismo.`
  }

  return `Eres Kairo, el ángel personal de ${user.name}.

Personalidad: cálido, directo, empático. Español natural, tuteo siempre. Conciso (máx 3-4 frases). Nunca condescendiente. Cuando tienes datos reales, los usas sin decir "según tus datos" — habla como si lo supieras de forma natural.

HOY: ${today}
${weather ? `\nTIEMPO: ${weather}` : ''}
AGENDA HOY:
${eventsText}

ESTADO FÍSICO: ${stepsText}
ESTADO EMOCIONAL: ${checkinText}
FINANZAS: ${financeText}

ALERTAS (${user.active_alerts || 0} activas):
${alertsText}

PLAN DEPORTIVO: ${sportContext}
PLAN NUTRICIONAL: ${nutritionContext}

PERFIL: ${user.city || 'Madrid'} · Plan ${user.plan} · Intereses: ${(user.interests || []).join(', ') || 'no especificados'}

ACCIONES QUE PUEDES EJECUTAR — cuando el usuario pida alguna de estas cosas, incluye al final de tu respuesta la acción correspondiente (el usuario NO la ve):

1. Añadir entreno al calendario:
KAIRO_ACTION:{"type":"add_calendar_event","title":"Entreno: [tipo]","time":"[hora]","day":[dia],"month":[mes],"year":[año],"category":"SPORT"}

2. Marcar entreno completado:
KAIRO_ACTION:{"type":"complete_workout","name":"[nombre]","duration_minutes":[min],"calories":[kcal]}

3. Gestionar intereses:
KAIRO_ACTION:{"type":"update_interests","add":[],"remove":[]}

4. Generar lista de la compra (cuando el usuario la pida):
KAIRO_ACTION:{"type":"shopping_list","items":["item1","item2",...]}

5. Crear alerta personalizada:
KAIRO_ACTION:{"type":"create_alert","title":"[titulo]","description":"[desc]","module":"[legal|financial|emotional|social|sport]","priority":[1-3]}

LÍMITES: No ejecutas transacciones bancarias. No asesoras inversiones (MiFID II). No eres médico ni abogado. En crisis severa → Teléfono de la Esperanza 717 003 717.`
}

// ── RUTAS ──────────────────────────────────────────────────────────────────────
const chatRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post('/message', { preHandler: requireAuth }, async (request, reply) => {
    const { message, conversation_history } = MessageSchema.parse(request.body)
    const user_id = request.user!.sub

    const [userRows, alerts, statsRows, todayEvents, sportRows, checkinRows, financeRows, sportPlanRows] = await Promise.all([
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
          COALESCE(SUM(CASE WHEN tx_type='debit'  THEN amount ELSE 0 END),0) as total_expenses
        FROM financial_transactions t
        JOIN financial_accounts a ON t.account_id = a.id
        WHERE t.user_id = ${user_id} AND DATE_TRUNC('month', tx_date) = DATE_TRUNC('month', CURRENT_DATE)
      `.catch(() => [null]),
      fastify.db`
        SELECT training_plan, nutrition_plan, objective, level
        FROM sport_plans WHERE user_id = ${user_id} LIMIT 1
      `.catch(() => []),
    ])

    const user = userRows[0]
    if (!user) return reply.code(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' } })

    // Parsear planes
    const sportPlanRow = sportPlanRows[0]
    let sportPlan = null, nutritionPlan = null
    if (sportPlanRow) {
      try {
        sportPlan = typeof sportPlanRow.training_plan === 'string'
          ? JSON.parse(sportPlanRow.training_plan) : sportPlanRow.training_plan
        nutritionPlan = typeof sportPlanRow.nutrition_plan === 'string'
          ? JSON.parse(sportPlanRow.nutrition_plan) : sportPlanRow.nutrition_plan
      } catch (e) {}
    }

    const stats = statsRows[0]
    const sport = sportRows[0]
    const checkin = checkinRows[0]
    const finance = financeRows[0]

    const weatherText = await getWeather(user.city || 'Madrid')

    const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

    const eventsText = todayEvents.length > 0
      ? todayEvents.map((e: any) => `• ${e.time} ${e.title}`).join('\n')
      : 'Sin eventos hoy'

    const stepsText = sport
      ? `${sport.steps_today?.toLocaleString('es-ES') || 0} pasos hoy · ${sport.workouts_week || 0}/${sport.workouts_goal || 5} entrenos esta semana`
      : 'Sin datos deportivos'

    const checkinText = checkin
      ? `Mood ${checkin.mood}/5 · Energía ${checkin.energy}/5 · Estrés ${checkin.stress}/5${checkin.notes ? ` · "${checkin.notes}"` : ''}`
      : 'Sin check-in hoy'

    const financeText = finance
      ? `Ingresos: ${Number(finance.total_income).toFixed(0)}€ · Gastos: ${Number(finance.total_expenses).toFixed(0)}€`
      : 'Sin datos financieros'

    const alertsText = alerts.length > 0
      ? alerts.map((a: any) => `• [${a.module}] ${a.title}`).join('\n')
      : 'Sin alertas activas'

    const systemPrompt = buildSystemPrompt(
      { ...user, active_alerts: stats?.active_alerts || 0 },
      weatherText, eventsText, stepsText, checkinText, financeText, alertsText,
      sportPlan, nutritionPlan, today
    )

    await fastify.db`INSERT INTO chat_messages (user_id, role, content) VALUES (${user_id}, 'user', ${message})`

    const claudeMessages = [
      ...conversation_history.map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: message }
    ]

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: systemPrompt,
      messages: claudeMessages,
    })

    const rawMessage = response.content[0].type === 'text'
      ? response.content[0].text : 'Lo siento, no pude procesar tu mensaje.'

    // Procesar KAIRO_ACTION
    let assistantMessage = rawMessage
    const actionMatch = rawMessage.match(/KAIRO_ACTION:(\{.*?\})/s)
    if (actionMatch) {
      try {
        const action = JSON.parse(actionMatch[1])
        assistantMessage = rawMessage.replace(/KAIRO_ACTION:\{.*?\}/s, '').trim()

        switch (action.type) {
          case 'update_interests':
            if (action.remove?.length > 0) {
              for (const val of action.remove) {
                await fastify.db`DELETE FROM user_detected_interests WHERE user_id = ${user_id} AND interest_value ILIKE ${'%' + val + '%'}`
              }
            }
            if (action.add?.length > 0) {
              for (const val of action.add) {
                const type = ['techno','house','electro','edm','trance','reggaeton','trap','jazz','rock','pop','metal','flamenco','electronica','festival','genero'].some(g => val.includes(g)) ? 'music_genre' : 'music_artist'
                await fastify.db`INSERT INTO user_detected_interests (user_id, interest_type, interest_value, detected_at, confidence, detection_count) VALUES (${user_id}, ${type}, ${val}, NOW(), 0.9, 1) ON CONFLICT (user_id, interest_type, interest_value) DO UPDATE SET confidence = 0.9, detected_at = NOW()`
              }
            }
            break

          case 'add_calendar_event':
            await fastify.db`
              INSERT INTO calendar_events (user_id, title, time, event_date, category, created_at)
              VALUES (${user_id}, ${action.title}, ${action.time || '08:00'}, 
                MAKE_DATE(${action.year || new Date().getFullYear()}, ${action.month || new Date().getMonth()+1}, ${action.day || new Date().getDate()}),
                ${action.category || 'SPORT'}, NOW())
              ON CONFLICT DO NOTHING
            `.catch((e: any) => fastify.log.warn('Error añadiendo evento al calendario:', e))
            break

          case 'complete_workout':
            await fastify.db`
              INSERT INTO sport_workouts (user_id, name, duration_minutes, calories_burned, worked_at)
              VALUES (${user_id}, ${action.name || 'Entreno'}, ${action.duration_minutes || 45}, ${action.calories || 300}, NOW())
            `.catch((e: any) => fastify.log.warn('Error registrando entreno:', e))
            break

          case 'shopping_list':
            if (action.items?.length > 0) {
              await fastify.db`
                INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
                VALUES (${user_id}, ${'SHOP-' + Date.now()}, 'social', 'suggestion', 2,
                  '🛒 Lista de la compra semanal',
                  ${action.items.join(' · ')},
                  'pending', NOW())
              `.catch((e: any) => fastify.log.warn('Error creando lista compra:', e))
            }
            break

          case 'create_alert':
            await fastify.db`
              INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
              VALUES (${user_id}, ${'KAI-' + Date.now()}, ${action.module || 'social'}, 'suggestion',
                ${action.priority || 2}, ${action.title}, ${action.description}, 'pending', NOW())
            `.catch((e: any) => fastify.log.warn('Error creando alerta:', e))
            break
        }
      } catch (e) { fastify.log.warn('Error procesando KAIRO_ACTION:', e) }
    }

    await fastify.db`INSERT INTO chat_messages (user_id, role, content) VALUES (${user_id}, 'assistant', ${assistantMessage})`

    // Extraer intereses de forma asíncrona
    extractAndSaveInterests(fastify, user_id, message, assistantMessage).catch(() => {})

    const crisisKeywords = ['suicid', 'hacerme daño', 'no quiero vivir', 'quitarme la vida', 'autolesion']
    const hasCrisisSignal = crisisKeywords.some(kw => message.toLowerCase().includes(kw))

    return reply.send({
      success: true,
      data: {
        message: assistantMessage,
        crisis: hasCrisisSignal,
        emergency_number: hasCrisisSignal ? '717 003 717' : null
      }
    })
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
async function extractAndSaveInterests(fastify: any, user_id: string, message: string, response: string): Promise<void> {
  try {
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const combined = normalize(message + ' ' + response)
    const detected: { type: string; value: string }[] = []

    const footballTeams = [
      'atletico','atleti','real madrid','madrid','barcelona','barca','sevilla','valencia',
      'betis','villarreal','athletic','bilbao','sociedad','juventus','milan','inter','napoli',
      'roma','arsenal','chelsea','liverpool','manchester','city','united','psg','bayern','dortmund'
    ]
    const musicArtists = [
      'rosalia','bad bunny','j balvin','shakira','alejandro sanz','coldplay','taylor swift',
      'beyonce','drake','rihanna','maluma','ozuna','anuel','karol g','rauw alejandro',
      'dua lipa','the weeknd','harry styles','billie eilish','david guetta','calvin harris',
      'tiesto','martin garrix','flume','disclosure','bicep'
    ]
    const musicGenres = [
      'techno','house','electronica','edm','trance','ambient','reggaeton','trap','hiphop',
      'hip hop','rap','jazz','blues','soul','rock','metal','punk','indie','pop','flamenco',
      'salsa','cumbia','drum and bass','dubstep','tech house','minimal','festival','festivales'
    ]

    footballTeams.forEach(t => { if (combined.includes(normalize(t))) detected.push({ type: 'football_team', value: t }) })
    musicArtists.forEach(a => { if (combined.includes(normalize(a))) detected.push({ type: 'music_artist', value: a }) })
    musicGenres.forEach(g => { if (combined.includes(normalize(g))) detected.push({ type: 'music_genre', value: g }) })

    if (detected.length === 0) return

    for (const interest of detected) {
      await fastify.db`
        INSERT INTO user_detected_interests (user_id, interest_type, interest_value, detected_at, confidence, detection_count)
        VALUES (${user_id}, ${interest.type}, ${interest.value}, NOW(), 0.8, 1)
        ON CONFLICT (user_id, interest_type, interest_value)
        DO UPDATE SET detected_at = NOW(), confidence = LEAST(user_detected_interests.confidence + 0.1, 1.0), detection_count = user_detected_interests.detection_count + 1
      `
    }
  } catch (err) {
    console.warn('Error extrayendo intereses:', err)
  }
}
