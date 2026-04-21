# Kairo API — Backend

API REST construida con **Node.js 20 + TypeScript + Fastify**.

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Fastify 4 + TypeScript |
| Base de datos | PostgreSQL 16 (Supabase) |
| Cache / Cola | Redis (Upstash) |
| Auth | JWT (RS256) |
| Validación | Zod |
| ORM | postgres.js (SQL nativo) |
| Motor alertas | Python 3.11 + FastAPI (microservicio separado) |

---

## Instalación

```bash
# 1. Clonar e instalar dependencias
cd kairo-api
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de Supabase, Redis, etc.

# 3. Crear las tablas en la base de datos
# Ejecutar src/db/schema.sql en Supabase SQL Editor

# 4. Arrancar en desarrollo
npm run dev
```

---

## Endpoints disponibles

### Auth
```
POST   /api/v1/auth/register     Crear cuenta
POST   /api/v1/auth/login        Iniciar sesión
POST   /api/v1/auth/refresh      Refrescar token
POST   /api/v1/auth/logout       Cerrar sesión
GET    /api/v1/auth/me           Usuario actual
```

### Usuarios
```
GET    /api/v1/users/me/profile      Perfil completo
PATCH  /api/v1/users/me/profile      Actualizar perfil
PATCH  /api/v1/users/me/modules      Cambiar módulos activos
GET    /api/v1/users/me/preferences  Preferencias
PATCH  /api/v1/users/me/preferences  Actualizar preferencias
GET    /api/v1/users/me/stats        Estadísticas del dashboard
DELETE /api/v1/users/me              Eliminar cuenta (RGPD)
```

### Alertas
```
GET    /api/v1/alerts            Listar alertas (paginado)
GET    /api/v1/alerts/stats      Estadísticas del mes
GET    /api/v1/alerts/:id        Detalle de alerta
PATCH  /api/v1/alerts/:id/read   Marcar como leída
POST   /api/v1/alerts/:id/action Ejecutar acción
POST   /api/v1/alerts/:id/snooze Posponer
DELETE /api/v1/alerts/:id        Descartar
```

### Sistema
```
GET    /api/v1/health            Estado de todos los servicios
```

---

## Estructura del proyecto

```
kairo-api/
├── src/
│   ├── server.ts           ← Entry point
│   ├── types/
│   │   └── index.ts        ← Tipos TypeScript globales
│   ├── plugins/
│   │   ├── db.ts           ← Conexión PostgreSQL
│   │   └── redis.ts        ← Conexión Redis
│   ├── middleware/
│   │   └── auth.ts         ← Middleware JWT
│   ├── routes/
│   │   ├── auth/           ← Registro, login, tokens
│   │   ├── users/          ← Perfil, preferencias, módulos
│   │   ├── alerts/         ← CRUD alertas + acciones
│   │   └── health/         ← Health check
│   └── db/
│       └── schema.sql      ← Esquema PostgreSQL completo
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Próximos endpoints a implementar

- `POST /api/v1/finance/connect` — Open Banking Tink
- `GET  /api/v1/finance/transactions` — Transacciones
- `GET  /api/v1/finance/budgets` — Presupuestos
- `POST /api/v1/social/connections` — Matchmaking
- `POST /api/v1/chat/message` — Chat con el ángel (Claude API)
- `POST /api/v1/mood/checkin` — Check-in emocional

---

*Kairo API v1.0 · El momento exacto. Para todo.*
