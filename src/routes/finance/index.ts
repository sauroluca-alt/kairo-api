import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'

const GoalSchema = z.object({
  name:     z.string().min(1).max(100),
  target:   z.number().positive(),
  current:  z.number().min(0).default(0),
  deadline: z.string().optional(),
})

const BudgetSchema = z.object({
  category: z.string().min(1).max(50),
  amount:   z.number().positive(),
  period:   z.enum(['monthly', 'weekly', 'yearly']).default('monthly'),
})

const financeRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /finance/summary — resumen financiero del mes actual
  fastify.get('/summary', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub

    // Cuenta(s) bancaria(s)
    const accounts = await fastify.db`
      SELECT id, bank_name, balance, last_sync, sync_status
      FROM financial_accounts
      WHERE user_id = ${user_id}
      ORDER BY created_at ASC
    `

    // Totales del mes actual
    const [monthStats] = await fastify.db`
      SELECT
        COALESCE(SUM(CASE WHEN tx_type = 'credit' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN tx_type = 'debit'  THEN amount ELSE 0 END), 0) AS total_expenses
      FROM financial_transactions t
      JOIN financial_accounts a ON t.account_id = a.id
      WHERE t.user_id = ${user_id}
        AND DATE_TRUNC('month', tx_date) = DATE_TRUNC('month', CURRENT_DATE)
    `

    // Totales del mes anterior (para calcular variación)
    const [prevMonthStats] = await fastify.db`
      SELECT
        COALESCE(SUM(CASE WHEN tx_type = 'credit' THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN tx_type = 'debit'  THEN amount ELSE 0 END), 0) AS total_expenses
      FROM financial_transactions t
      JOIN financial_accounts a ON t.account_id = a.id
      WHERE t.user_id = ${user_id}
        AND DATE_TRUNC('month', tx_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
    `

    // Suscripciones (categoría 'subscriptions' o 'suscripciones')
    const [subStats] = await fastify.db`
      SELECT COALESCE(SUM(amount), 0) AS subscriptions_total
      FROM financial_transactions t
      JOIN financial_accounts a ON t.account_id = a.id
      WHERE t.user_id = ${user_id}
        AND LOWER(t.category) IN ('subscriptions','suscripciones','streaming','memberships')
        AND DATE_TRUNC('month', tx_date) = DATE_TRUNC('month', CURRENT_DATE)
    `

    const income   = Number(monthStats?.total_income)   || 0
    const expenses = Number(monthStats?.total_expenses)  || 0
    const prevExp  = Number(prevMonthStats?.total_expenses) || 0
    const netSavings = income - expenses
    const balanceChange = prevExp > 0 ? ((expenses - prevExp) / prevExp * 100) : 0

    const primaryAccount = accounts[0]

    return reply.send({
      success: true,
      data: {
        total_income:         income,
        total_expenses:       expenses,
        net_savings:          netSavings,
        balance_change:       balanceChange,
        subscriptions_total:  Number(subStats?.subscriptions_total) || 0,
        bank_name:            primaryAccount?.bank_name    || 'Sin vincular',
        bank_last_sync:       primaryAccount?.last_sync    ? formatTimeAgo(primaryAccount.last_sync) : 'nunca',
        sync_status:          primaryAccount?.sync_status  || 'pending',
        accounts_count:       accounts.length,
      },
    })
  })

  // GET /finance/expenses — gastos por categoría del mes
  fastify.get('/expenses', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub

    const expenses = await fastify.db`
      SELECT
        COALESCE(t.category, 'Otros') AS category,
        SUM(t.amount) AS spent
      FROM financial_transactions t
      JOIN financial_accounts a ON t.account_id = a.id
      WHERE t.user_id = ${user_id}
        AND t.tx_type = 'debit'
        AND DATE_TRUNC('month', t.tx_date) = DATE_TRUNC('month', CURRENT_DATE)
      GROUP BY COALESCE(t.category, 'Otros')
      ORDER BY spent DESC
    `

    const budgets = await fastify.db`
      SELECT category, amount AS budget_limit
      FROM financial_budgets
      WHERE user_id = ${user_id} AND active = TRUE AND period = 'monthly'
    `

    const budgetMap: Record<string, number> = {}
    budgets.forEach((b: any) => { budgetMap[b.category] = Number(b.budget_limit) })

    const result = expenses.map((e: any) => ({
      category: e.category,
      spent:    Number(e.spent),
      limit:    budgetMap[e.category] || 0,
    }))

    return reply.send({ success: true, data: result })
  })

  // GET /finance/goals — objetivos de ahorro
  fastify.get('/goals', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const goals = await fastify.db`
      SELECT id, name, target, current, deadline, completed, created_at
      FROM financial_goals
      WHERE user_id = ${user_id} AND completed = FALSE
      ORDER BY created_at DESC
    `
    return reply.send({
      success: true,
      data: goals.map((g: any) => ({
        id:        g.id,
        name:      g.name,
        target:    Number(g.target),
        current:   Number(g.current),
        deadline:  g.deadline,
        completed: g.completed,
      }))
    })
  })

  // POST /finance/goals — crear objetivo de ahorro
  fastify.post('/goals', { preHandler: requireAuth }, async (request, reply) => {
    const { name, target, current, deadline } = GoalSchema.parse(request.body)
    const user_id = request.user!.sub
    const [goal] = await fastify.db`
      INSERT INTO financial_goals (user_id, name, target, current, deadline)
      VALUES (${user_id}, ${name}, ${target}, ${current}, ${deadline || null})
      RETURNING *
    `
    return reply.code(201).send({ success: true, data: goal })
  })

  // PATCH /finance/goals/:id — actualizar progreso de un objetivo
  fastify.patch('/goals/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { current } = request.body as { current: number }
    const user_id = request.user!.sub
    const [goal] = await fastify.db`
      UPDATE financial_goals
      SET current = ${current}, completed = (${current} >= target), updated_at = NOW()
      WHERE id = ${id} AND user_id = ${user_id}
      RETURNING *
    `
    if (!goal) return reply.code(404).send({ success: false, error: 'Not found' })
    return reply.send({ success: true, data: goal })
  })

  // GET /finance/budgets — presupuestos del usuario
  fastify.get('/budgets', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const budgets = await fastify.db`
      SELECT id, category, amount, period
      FROM financial_budgets
      WHERE user_id = ${user_id} AND active = TRUE
      ORDER BY category
    `
    return reply.send({ success: true, data: budgets })
  })

  // POST /finance/budgets — crear o actualizar presupuesto
  fastify.post('/budgets', { preHandler: requireAuth }, async (request, reply) => {
    const { category, amount, period } = BudgetSchema.parse(request.body)
    const user_id = request.user!.sub
    const [budget] = await fastify.db`
      INSERT INTO financial_budgets (user_id, category, amount, period)
      VALUES (${user_id}, ${category}, ${amount}, ${period})
      ON CONFLICT (user_id, category, period)
      DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW()
      RETURNING *
    `
    return reply.code(201).send({ success: true, data: budget })
  })

  // GET /finance/transactions — últimas transacciones
  fastify.get('/transactions', { preHandler: requireAuth }, async (request, reply) => {
    const { limit = 20, page = 1 } = request.query as { limit?: number; page?: number }
    const offset = (Number(page) - 1) * Number(limit)
    const user_id = request.user!.sub

    const txs = await fastify.db`
      SELECT t.id, t.amount, t.tx_type, t.description, t.category,
             t.merchant_name, t.tx_date, a.bank_name
      FROM financial_transactions t
      JOIN financial_accounts a ON t.account_id = a.id
      WHERE t.user_id = ${user_id}
      ORDER BY t.tx_date DESC, t.created_at DESC
      LIMIT ${Number(limit)} OFFSET ${offset}
    `

    return reply.send({
      success: true,
      data: txs.map((t: any) => ({
        id:            t.id,
        amount:        Number(t.amount),
        type:          t.tx_type,
        description:   t.description || t.merchant_name || 'Sin descripción',
        category:      t.category    || 'Otros',
        date:          t.tx_date,
        bank:          t.bank_name,
      }))
    })
  })
}

function formatTimeAgo(date: Date | string): string {
  const d = new Date(date)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  return `hace ${Math.floor(hours / 24)}d`
}

export default financeRoutes
