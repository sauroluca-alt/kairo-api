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

// Mapa de nombres coloquiales → ID exacto en football-data.org
const TEAM_ID_MAP: Record<string, number> = {
  // España
  'atletico': 78, 'atleti': 78, 'atlético': 78, 'atletico de madrid': 78,
  'real madrid': 86, 'madrid': 86,
  'barcelona': 81, 'barça': 81, 'barca': 81,
  'sevilla': 559,
  'valencia': 95,
  'betis': 90, 'real betis': 90,
  'villarreal': 94,
  'athletic': 77, 'bilbao': 77, 'athletic bilbao': 77,
  'sociedad': 92, 'real sociedad': 92,
  'osasuna': 79,
  'girona': 298,
  'getafe': 83,
  'las palmas': 275,
  'rayo': 88, 'rayo vallecano': 88,
  'celta': 558, 'celta vigo': 558,
  'alaves': 263,
  'leganes': 745,
  'espanyol': 80,
  'mallorca': 89,
  'valladolid': 250,
  // Internacional
  'juventus': 109,
  'milan': 98, 'ac milan': 98,
  'inter': 108, 'inter milan': 108,
  'napoli': 113,
  'roma': 100,
  'arsenal': 57,
  'chelsea': 61,
  'liverpool': 64,
  'manchester city': 65, 'city': 65,
  'manchester united': 66, 'united': 66,
  'psg': 85, 'paris': 85,
  'bayern': 5, 'bayern munich': 5,
  'dortmund': 4, 'borussia': 4,
}

async function searchFootballMatches(teamName: string): Promise<any[]> {
  try {
    const token = process.env.FOOTBALL_DATA_TOKEN
    if (!token) return []

    const normalized = teamName.toLowerCase().trim()

    // Buscar ID directo en el mapa
    let teamId: number | null = null
    for (const [key, id] of Object.entries(TEAM_ID_MAP)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        teamId = id
        break
      }
    }

    if (!teamId) {
      // Fallback: búsqueda por nombre
      const teamsRes = await fetch(
        `https://api.football-data.org/v4/teams?search=${encodeURIComponent(teamName)}`,
        { headers: { 'X-Auth-Token': token } }
      )
      if (!teamsRes.ok) return []
      const teamsData = await teamsRes.json() as any
      teamId = teamsData.teams?.[0]?.id
      if (!teamId) return []
    }

    const matchesRes = await fetch(
      `https://api.football-data.org/v4/teams/${teamId}/matches?status=SCHEDULED&limit=5`,
      { headers: { 'X-Auth-Token': token } }
    )
    if (!matchesRes.ok) return []

    const matchesData = await matchesRes.json() as any
    return (matchesData.matches || []).map((m: any) => ({
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
    const interests = await db`
      SELECT interest_type, interest_value, confidence
      FROM user_detected_interests
      WHERE user_id = ${userId}
        AND confidence >= 0.7
      ORDER BY confidence DESC, detection_count DESC
      LIMIT 10
    `

    console.log(`[Proactive] Usuario ${userId}: ${interests.length} intereses`)
    if (interests.length === 0) return 0

    const [user] = await db`SELECT city FROM users WHERE id = ${userId} LIMIT 1`
    const city = user?.city || 'Madrid'

    for (const interest of interests) {
      console.log(`[Proactive] Procesando: ${interest.interest_type} = ${interest.interest_value}`)

      if (interest.interest_type === 'music_artist') {
        const concerts = await searchConcerts(interest.interest_value, city)
        console.log(`[Proactive] Conciertos encontrados para ${interest.interest_value}: ${concerts.length}`)

        for (const concert of concerts.slice(0, 2)) {
          if (!concert.date) continue
          const existing = await db`
            SELECT id FROM alerts
            WHERE user_id = ${userId}
              AND rule_id = ${'EVT-' + concert.id.slice(0, 8)}
            LIMIT 1
          `
          if (existing.length > 0) continue
          const priceInfo = concert.price_min ? ` · Desde ${concert.price_min}€` : ''
          await db`
            INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
            VALUES (${userId}, ${'EVT-' + concert.id.slice(0, 8)}, 'social', 'suggestion', 2,
              ${`🎵 ${concert.name}`},
              ${`${concert.date} en ${concert.venue || concert.city || city}${priceInfo}`},
              'pending', NOW())
          `
          alertsCreated++
          console.log(`[Proactive] ✅ Alerta creada: ${concert.name}`)
        }
      }

      if (interest.interest_type === 'football_team') {
        const matches = await searchFootballMatches(interest.interest_value)
        console.log(`[Proactive] Partidos encontrados para ${interest.interest_value}: ${matches.length}`)

        for (const match of matches.slice(0, 2)) {
          const existing = await db`
            SELECT id FROM alerts WHERE user_id = ${userId} AND rule_id = ${'FTB-' + match.id} LIMIT 1
          `
          if (existing.length > 0) continue
          const date = new Date(match.date)
          const dateStr = date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
          const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
          await db`
            INSERT INTO alerts (user_id, rule_id, module, type, priority, title, description, status, created_at)
            VALUES (${userId}, ${'FTB-' + match.id}, 'social', 'motivation', 3,
              ${`⚽ ${match.home_team} vs ${match.away_team}`},
              ${`${dateStr} a las ${timeStr} · ${match.competition}`},
              'pending', NOW())
          `
          alertsCreated++
          console.log(`[Proactive] ✅ Alerta creada: ${match.home_team} vs ${match.away_team}`)
        }
      }
    }
  } catch (err) {
    console.error('[Proactive] Error:', err)
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
