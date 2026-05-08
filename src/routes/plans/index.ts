import type { FastifyPluginAsync } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../../middleware/auth.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Generar lista de la compra semanal desde el plan nutricional
async function generateShoppingList(nutritionPlan: any): Promise<string[]> {
  try {
    const mealsText = nutritionPlan.meals?.map((m: any) =>
      `${m.name}: ${m.recipe || m.description || ''}`
    ).join('\n') || ''

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `A partir de este plan nutricional semanal, genera una lista de la compra con los ingredientes necesarios para 7 días. Responde SOLO con un JSON array de strings, sin markdown ni texto adicional. Ejemplo: ["Pollo 1kg","Arroz 500g","Brócoli 2 unidades"]

PLAN:
${mealsText}`
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]'
    const clean = text.replace(/```json|```/g, '').trim()
    const start = clean.indexOf('[')
    const end = clean.lastIndexOf(']')
    if (start >= 0 && end > start) {
      return JSON.parse(clean.substring(start, end + 1))
    }
    return []
  } catch (e) {
    console.error('Error generando lista compra:', e)
    return []
  }
}

const plansRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /plans/sport — genera plan de entrenamiento + nutrición
  fastify.post('/sport', { preHandler: requireAuth }, async (request, reply) => {
    const body = request.body as any
    const { objective, level, days_per_week, session_minutes, weight, height, restrictions, diet_type } = body

    const prompt = `Eres un entrenador personal y nutricionista experto. Genera un plan PERSONALIZADO y DETALLADO.

PERFIL:
- Objetivo: ${objective}
- Nivel: ${level}
- Días disponibles: ${days_per_week} días/semana
- Tiempo por sesión: ${session_minutes} minutos
- Peso: ${weight || 'no especificado'} kg
- Altura: ${height || 'no especificado'} cm
- Restricciones físicas: ${restrictions?.join(', ') || 'ninguna'}
- Tipo de dieta: ${diet_type}

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown:

{
  "training_plan": {
    "title": "Nombre del plan",
    "duration_weeks": 8,
    "weekly_structure": [
      {
        "day": "Lunes",
        "type": "Fuerza tren superior",
        "focus": "Pecho y espalda",
        "duration": "45 min",
        "exercises": [{"name": "Press banca", "sets": "4", "reps": "10", "rest": "90s", "notes": "Agarre medio"}],
        "warmup": "5 min cardio ligero",
        "cooldown": "Estiramientos 5 min"
      }
    ],
    "tips": ["Consejo 1"]
  },
  "nutrition_plan": {
    "title": "Nombre del plan nutricional",
    "daily_calories": 2200,
    "macros": {"protein_g": 150, "carbs_g": 220, "fat_g": 80},
    "meals": [
      {"name": "Desayuno", "time": "07:30", "calories": 450, "description": "Avena con frutas", "recipe": "80g avena + 1 plátano + 200ml leche"},
      {"name": "Almuerzo", "time": "10:00", "calories": 200, "description": "Snack proteico", "recipe": "1 yogur griego + frutos secos"},
      {"name": "Comida", "time": "14:00", "calories": 650, "description": "Plato principal", "recipe": "150g pollo + arroz + verduras"},
      {"name": "Merienda", "time": "17:30", "calories": 250, "description": "Snack energético", "recipe": "Fruta + frutos secos"},
      {"name": "Cena", "time": "20:30", "calories": 500, "description": "Cena ligera", "recipe": "Pescado + ensalada + quinoa"}
    ],
    "hydration": "2.5L de agua al día",
    "supplements": [],
    "tips": ["Consejo nutricional 1"]
  }
}`

    try {
      const response = await client.messages.create({
        model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const start = clean.indexOf('{')
      const end = clean.lastIndexOf('}')
      if (start >= 0 && end > start) clean = clean.substring(start, end + 1)

      const plan = JSON.parse(clean)
      const user_id = request.user!.sub

      // Guardar el plan
      await fastify.db`
        INSERT INTO sport_plans (user_id, objective, level, training_plan, nutrition_plan, created_at)
        VALUES (${user_id}, ${objective}, ${level}, ${JSON.stringify(plan.training_plan)}, ${JSON.stringify(plan.nutrition_plan)}, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET objective = EXCLUDED.objective, level = EXCLUDED.level,
          training_plan = EXCLUDED.training_plan, nutrition_plan = EXCLUDED.nutrition_plan, created_at = NOW()
      `

      // 2. Añadir entrenos al calendario automáticamente
      const weekDays: Record<string, number> = {
        'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
        'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
      }
      const today = new Date()
      const currentDay = today.getDay()

      for (const workout of (plan.training_plan.weekly_structure || [])) {
        const dayName = workout.day?.toLowerCase() || ''
        const targetDay = weekDays[dayName]
        if (targetDay === undefined) continue

        // Calcular la próxima fecha para ese día de la semana
        let daysUntil = targetDay - currentDay
        if (daysUntil <= 0) daysUntil += 7
        const eventDate = new Date(today)
        eventDate.setDate(today.getDate() + daysUntil)

        await fastify.db`
          INSERT INTO calendar_events (user_id, title, time, event_date, category, created_at)
          VALUES (${user_id}, ${`💪 ${workout.type} - ${workout.focus}`}, '08:00',
            ${eventDate.toISOString().split('T')[0]}, 'SPORT', NOW())
          ON CONFLICT DO NOTHING
        `.catch(() => {})
      }

      // 3. Generar lista de la compra
      const shoppingItems = await generateShoppingList(plan.nutrition_plan)
      if (shoppingItems.length > 0) {
        await fastify.db`
          INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
          VALUES (${user_id}, ${'SHOP-' + Date.now()}, 'social', 'suggestion', 2,
            '🛒 Lista de la compra semanal',
            ${shoppingItems.slice(0, 20).join(' · ')},
            'pending', NOW())
        `.catch(() => {})
      }

      // 4. Crear alertas de recordatorio de comidas principales
      const mealAlerts = [
        { meal: 'Almuerzo', time: '10:00', rule: 'MEAL-ALM' },
        { meal: 'Comida', time: '13:45', rule: 'MEAL-COM' },
        { meal: 'Merienda', time: '17:15', rule: 'MEAL-MER' },
        { meal: 'Cena', time: '20:15', rule: 'MEAL-CEN' },
      ]

      for (const alert of mealAlerts) {
        const meal = plan.nutrition_plan.meals?.find((m: any) =>
          m.name?.toLowerCase().includes(alert.meal.toLowerCase())
        )
        if (meal) {
          await fastify.db`
            INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
            VALUES (${user_id}, ${alert.rule + '-' + user_id.slice(0,8)}, 'social', 'motivation', 3,
              ${`🍽️ ${meal.name} a las ${meal.time}`},
              ${meal.description?.slice(0, 100) || ''},
              'pending', NOW())
            ON CONFLICT DO NOTHING
          `.catch(() => {})
        }
      }

      return reply.send({ success: true, data: plan })

    } catch (err: any) {
      fastify.log.error({ err }, 'Error generando plan deportivo')
      return reply.code(500).send({ success: false, error: { code: 'PLAN_ERROR', message: err.message } })
    }
  })

  // GET /plans/sport — obtener plan guardado
  fastify.get('/sport', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const [plan] = await fastify.db`
      SELECT objective, level, training_plan, nutrition_plan, created_at
      FROM sport_plans WHERE user_id = ${user_id}
    `.catch(() => [null])

    return reply.send({
      success: true,
      data: plan ? {
        objective: plan.objective,
        level: plan.level,
        training_plan: plan.training_plan,
        nutrition_plan: plan.nutrition_plan,
        created_at: plan.created_at
      } : null
    })
  })

  // POST /plans/shopping — generar lista de la compra bajo demanda
  fastify.post('/shopping', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const [planRow] = await fastify.db`
      SELECT nutrition_plan FROM sport_plans WHERE user_id = ${user_id}
    `.catch(() => [null])

    if (!planRow) {
      return reply.code(404).send({ success: false, error: { code: 'NO_PLAN', message: 'No tienes plan nutricional' } })
    }

    const nutritionPlan = typeof planRow.nutrition_plan === 'string'
      ? JSON.parse(planRow.nutrition_plan) : planRow.nutrition_plan

    const items = await generateShoppingList(nutritionPlan)

    // Guardar como alerta
    await fastify.db`
      INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
      VALUES (${user_id}, ${'SHOP-' + Date.now()}, 'social', 'suggestion', 2,
        '🛒 Lista de la compra semanal',
        ${items.slice(0, 25).join(' · ')},
        'pending', NOW())
    `.catch(() => {})

    return reply.send({ success: true, data: { items } })
  })
}

export default plansRoutes
