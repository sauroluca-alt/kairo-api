import fp from 'fastify-plugin'
import postgres from 'postgres'
import type { FastifyPluginAsync } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    db: postgres.Sql
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: parseInt(process.env.DATABASE_POOL_MAX ?? '10'),
    idle_timeout: 30,
    connect_timeout: 10,
    transform: {
      undefined: null,
    },
    onnotice: (notice) => {
      fastify.log.debug({ notice }, 'PostgreSQL notice')
    },
  })

  // Test de conexión al arrancar
  try {
    await sql`SELECT 1`
    fastify.log.info('✅ PostgreSQL conectado')
  } catch (err) {
    fastify.log.error({ err }, '❌ Error conectando a PostgreSQL')
    throw err
  }

  fastify.decorate('db', sql)

  fastify.addHook('onClose', async () => {
    await sql.end()
    fastify.log.info('PostgreSQL desconectado')
  })
}

export default fp(dbPlugin, { name: 'db' })
