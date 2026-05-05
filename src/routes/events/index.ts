import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../middleware/auth.js'

// ── MOTOR PROACTIVO DE EVENTOS ─────────────────────────────────────────────────

// Buscar conciertos en Ticketmaster para un artista
async function searchConcerts(artist: string, city: string = 'Madrid'): Promise<any[]> {
  try {
    const apiKey = process.env.TICKETMASTER_API_KEY
    if (!apiKey) return []

    const url = `https://app.ticketmaster.com/discovery/v2/events.json?` +
      `apikey=${apiKey}&keyword=${encodeURIComponent(artist)}&city=${encodeURIComponent(city)}` +
      `&countryCode=ES&size=5&sort=date,asc`

    const res = await fetch(url)
    if (!res.ok) return []

    const data = await res.json() as any
    const events = data?._embedded?.events || []

    return events.map((e: any) => ({
      id: e.id,
      name: e.name,
      date: e.dates?.start?.localDate,
      time: e.dates?.start?.localTime,
      venue: e._embedded?.venues?.[0]?.name,
      city: e._embedded?.venues?.[0]?.city?.name,
      url: e.url,
      price_min: e.priceRanges?.[0]?.min,
      price_max: e.priceRanges?.[0]?.max,
    }))
  } catch (err) {
    console.error('Ticketmaster error:', err)
    return []
  }
}

// Buscar partidos de fútbol para un equipo
async function searchFootballMatches(teamName: string): Promise<any[]> {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) return []

    // Primero buscar el ID del equipo
    const teamsRes = await fetch(
      `https://api.football-data.org/v4/teams?search=${encodeURIComponent(teamName)}`,
      { headers: { 'X-Auth-Token': token } }
    )
    if (!teamsRes.ok) return []

    const teamsData = await teamsRes.json() as any
    const team = teamsData.teams?.[0]
    if (!team) return []

    // Buscar próximos partidos del equipo
    const matchesRes = await fetch(
      `https://api.football-data.org/v4/teams/${team.id}/matches?status=SCHEDULED&limit=5`,
      { headers: { 'X-Auth-Token': token } }
    )
    if (!matchesRes.ok) return []

    const matchesData = await matchesRes.json() as any
    const matches = matchesData.matches || []

    return matches.map((m: any) => ({
      id: m.id,
      home_team: m.homeTeam?.name,
      away_team: m.awayTeam?.name,
      date: m.utcDate,
      competition: m.competition?.name,
      status: m.status,
    }))
  } catch (err) {
    console.error('Football-data error:', err)
    return []
  }
}

// Generar alertas proactivas para un usuario basadas en sus intereses
async function generateProactiveAlerts(db: any, userId: string): Promise<number> {
  let alertsCreated = 0

  try {
    // Obtener intereses del usuario
    const interests = await db`
      SELECT interest_type, interest_value, confidence
      FROM user_detected_interests
      WHERE user_id = ${userId}
        AND confidence >= 0.7
      ORDER BY confidence DESC, detection_count DESC
      LIMIT 10
    `

    if (interests.length === 0) return 0

    // Obtener ciudad del usuario
    const [user] = await db`SELECT city FROM users WHERE id = ${userId} LIMIT 1`
    const city = user?.city || 'Madrid'

    for (const interest of interests) {
      if (interest.interest_type === 'music_artist') {
        // Buscar conciertos del artista
        const concerts = await searchConcerts(interest.interest_value, city)

        for (const concert of concerts.slice(0, 2)) {
          if (!concert.date) continue

          // Verificar que no existe ya esta alerta
          const existing = await db`
            SELECT id FROM alerts
            WHERE user_id = ${userId}
              AND rule_id = ${'EVT-' + concert.id.slice(0, 8)}
            LIMIT 1
          `
          if (existing.length > 0) continue

          const priceInfo = concert.price_min
            ? ` · Desde ${concert.price_min}€`
            : ''

          await db`
            INSERT INTO alerts (
              user_id, rule_id, module, type, priority,
              title, description, status, created_at
            ) VALUES (
              ${userId},
              ${'EVT-' + concert.id.slice(0, 8)},
              'social',
              'suggestion',
              2,
              ${`🎵 ${concert.name}`},
              ${`${concert.date} en ${concert.venue || concert.city || city}${priceInfo}`},
              'pending',
              NOW()
            )
          `
          alertsCreated++
        }
      }

      if (interest.interest_type === 'football_team') {
        // Buscar próximos partidos
        const matches = await searchFootballMatches(interest.interest_value)

        for (const match of matches.slice(0, 2)) {
          const existing = await db`
            SELECT id FROM alerts
            WHERE user_id = ${userId}
              AND rule_id = ${'FTB-' + match.id}
            LIMIT 1
          `
          if (existing.length > 0) continue

          const date = new Date(match.date)
          const dateStr = date.toLocaleDateString('es-ES', {
            weekday: 'long', day: 'numeric', month: 'long'
          })
          const timeStr = date.toLocaleTimeString('es-ES', {
            hour: '2-digit', minute: '2-digit'
          })

          await db`
            INSERT INTO alerts (
              user_id, rule_id, module, type, priority,
              title, description, status, created_at
            ) VALUES (
              ${userId},
              ${'FTB-' + match.id},
              'social',
              'motivation',
              3,
              ${`⚽ ${match.home_team} vs ${match.away_team}`},
              ${`${dateStr} a las ${timeStr} · ${match.competition}`},
              'pending',
              NOW()
            )
          `
          alertsCreated++
        }
      }
    }
  } catch (err) {
    console.error('Error generando alertas proactivas:', err)
  }

  return alertsCreated
}

// ── RUTAS ──────────────────────────────────────────────────────────────────────
const eventsRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /events/scan — escanear eventos para el usuario actual
  fastify.post('/scan', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const count = await generateProactiveAlerts(fastify.db, user_id)
    return reply.send({
      success: true,
      data: { alerts_created: count, message: `${count} nuevas alertas generadas` }
    })
  })

  // GET /events/concerts — buscar conciertos para un artista
  fastify.get('/concerts', { preHandler: requireAuth }, async (request, reply) => {
    const { artist, city = 'Madrid' } = request.query as { artist: string; city?: string }
    if (!artist) return reply.code(400).send({ success: false, error: 'artist requerido' })
    const concerts = await searchConcerts(artist, city)
    return reply.send({ success: true, data: concerts })
  })

  // GET /events/football — buscar partidos de un equipo
  fastify.get('/football', { preHandler: requireAuth }, async (request, reply) => {
    const { team } = request.query as { team: string }
    if (!team) return reply.code(400).send({ success: false, error: 'team requerido' })
    const matches = await searchFootballMatches(team)
    return reply.send({ success: true, data: matches })
  })

  // GET /events/proactive — obtener resumen de intereses detectados + eventos disponibles
  fastify.get('/proactive', { preHandler: requireAuth }, async (request, reply) => {
    const user_id = request.user!.sub
    const interests = await fastify.db`
      SELECT interest_type, interest_value, confidence, detection_count
      FROM user_detected_interests
      WHERE user_id = ${user_id}
      ORDER BY confidence DESC
    `
    return reply.send({ success: true, data: { interests } })
  })
}

export default eventsRoutes
export { generateProactiveAlerts }
