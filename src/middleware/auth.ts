import type { FastifyRequest, FastifyReply } from 'fastify'

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Token inválido o expirado' },
    })
  }
}

export async function requirePlan(
  plans: string[],
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!request.user) {
    return reply.code(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'No autenticado' },
    })
  }
  if (!plans.includes(request.user.plan)) {
    return reply.code(403).send({
      success: false,
      error: {
        code: 'PLAN_REQUIRED',
        message: `Esta función requiere plan: ${plans.join(' o ')}`,
      },
    })
  }
}
