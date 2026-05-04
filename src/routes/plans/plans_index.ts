import type { FastifyPluginAsync } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'
import { requireAuth } from '../../middleware/auth.js'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const plansRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /plans/sport — genera plan de entrenamiento + nutrición
  fastify.post('/sport', { preHandler: requireAuth }, async (request, reply) => {
    const body = request.body as any

    const {
      objective, level, days_per_week, session_minutes,
      weight, height, restrictions, diet_type
    } = body

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

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, sin explicaciones. Solo el JSON:

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
        "exercises": [
          {"name": "Press banca", "sets": "4", "reps": "10", "rest": "90s", "notes": "Agarre medio"}
        ],
        "warmup": "5 min cardio ligero + movilidad",
        "cooldown": "Estiramientos 5 min"
      }
    ],
    "tips": ["Consejo 1", "Consejo 2"]
  },
  "nutrition_plan": {
    "title": "Nombre del plan nutricional",
    "daily_calories": 2200,
    "macros": {"protein_g": 150, "carbs_g": 220, "fat_g": 80},
    "meals": [
      {
        "name": "Desayuno",
        "time": "07:30",
        "calories": 450,
        "description": "Avena con frutas y proteína",
        "recipe": "80g avena + 1 plátano + 30g proteína en polvo + 200ml leche"
      }
    ],
    "hydration": "2.5L de agua al día",
    "supplements": ["Proteína whey post-entreno"],
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

      // Limpiar y parsear JSON
      let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const start = clean.indexOf('{')
      const end = clean.lastIndexOf('}')
      if (start >= 0 && end > start) clean = clean.substring(start, end + 1)

      const plan = JSON.parse(clean)

      // Guardar el plan en la BD
      const user_id = request.user!.sub
      await fastify.db`
        INSERT INTO sport_plans (user_id, objective, level, training_plan, nutrition_plan, created_at)
        VALUES (${user_id}, ${objective}, ${level}, ${JSON.stringify(plan.training_plan)}, ${JSON.stringify(plan.nutrition_plan)}, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          objective = EXCLUDED.objective,
          level = EXCLUDED.level,
          training_plan = EXCLUDED.training_plan,
          nutrition_plan = EXCLUDED.nutrition_plan,
          created_at = NOW()
      `

      return reply.send({ success: true, data: plan })

    } catch (err: any) {
      fastify.log.error({ err }, 'Error generando plan deportivo')
      return reply.code(500).send({
        success: false,
        error: { code: 'PLAN_ERROR', message: err.message }
      })
    }
  })

  // GET /plans/sport — obtener plan guardado del usuario
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
}

export default plansRoutes
