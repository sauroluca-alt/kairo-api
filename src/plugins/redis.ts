import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'

// Cliente Redis simplificado en memoria para desarrollo sin Redis real
class MemoryRedis {
  private store = new Map<string, { value: string; expiry?: number }>()

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key)
    if (!item) return null
    if (item.expiry && Date.now() > item.expiry) { this.store.delete(key); return null }
    return item.value
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, { value })
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    this.store.set(key, { value, expiry: Date.now() + seconds * 1000 })
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }

  async ping(): Promise<string> {
    return 'PONG'
  }

  async quit(): Promise<void> {}
}

declare module 'fastify' {
  interface FastifyInstance {
    redis: MemoryRedis
  }
}

const redisPlugin: FastifyPluginAsync = async (fastify) => {
  if (process.env.REDIS_URL) {
    // Redis real si está configurado
    try {
      const { createClient } = await import('redis')
      const client = createClient({ url: process.env.REDIS_URL })
      client.on('error', (err) => fastify.log.error({ err }, 'Redis error'))
      await client.connect()
      fastify.log.info('✅ Redis conectado')
      fastify.decorate('redis', client as any)
      fastify.addHook('onClose', async () => { await client.quit() })
    } catch (err) {
      fastify.log.warn({ err }, '⚠️ Redis no disponible — usando memoria')
      fastify.decorate('redis', new MemoryRedis())
    }
  } else {
    // Sin Redis — usar memoria (solo para desarrollo)
    fastify.log.warn('⚠️ REDIS_URL no configurado — usando almacenamiento en memoria')
    fastify.decorate('redis', new MemoryRedis())
  }
}

export default fp(redisPlugin, { name: 'redis' })
