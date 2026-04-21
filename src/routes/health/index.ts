import type { FastifyPluginAsync } from 'fastify'

const healthRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /health
  fastify.get('/', async (_request, reply) => {
    const checks = {
      api: 'ok',
      db: 'unknown',
      redis: 'unknown',
      alert_engine: 'unknown',
    }

    // Check DB
    try {
      await fastify.db`SELECT 1`
      checks.db = 'ok'
    } catch {
      checks.db = 'error'
    }

    // Check Redis
    try {
      await fastify.redis.ping()
      checks.redis = 'ok'
    } catch {
      checks.redis = 'error'
    }

    // Check motor de alertas
    try {
      const res = await fetch(`${process.env.ALERT_ENGINE_URL}/health`, { signal: AbortSignal.timeout(2000) })
      checks.alert_engine = res.ok ? 'ok' : 'error'
    } catch {
      checks.alert_engine = 'error'
    }

    const allOk = Object.values(checks).every(v => v === 'ok')

    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? 'healthy' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      checks,
    })
  })
}

export default healthRoutes
