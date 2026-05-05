import { GoogleAuth } from 'google-auth-library'

// ── FCM V1 API ──────────────────────────────────────────────────────────────────
// Usa la API FCM v1 con autenticación OAuth2 via cuenta de servicio

let cachedAccessToken: string | null = null
let tokenExpiry: number = 0

async function getFCMAccessToken(): Promise<string> {
  // Reusar token si no ha expirado
  if (cachedAccessToken && Date.now() < tokenExpiry - 60000) {
    return cachedAccessToken
  }

  const auth = new GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
    },
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  })

  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  cachedAccessToken = tokenResponse.token!
  tokenExpiry = Date.now() + 3600000 // 1 hora
  return cachedAccessToken
}

export async function sendPushNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<boolean> {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID
    if (!projectId) {
      console.warn('FIREBASE_PROJECT_ID no configurado')
      return false
    }

    const accessToken = await getFCMAccessToken()

    const message = {
      message: {
        token: fcmToken,
        notification: { title, body },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channel_id: 'kairo_alerts',
          },
        },
        data: data || {},
      },
    }

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('FCM error:', error)
      return false
    }

    return true
  } catch (err) {
    console.error('Error enviando notificación FCM:', err)
    return false
  }
}

// Enviar notificación a un usuario por user_id
export async function sendNotificationToUser(
  db: any,
  userId: string,
  title: string,
  body: string,
  type: string = 'general'
): Promise<boolean> {
  try {
    const [user] = await db`
      SELECT fcm_token FROM users WHERE id = ${userId} AND fcm_token IS NOT NULL
    `
    if (!user?.fcm_token) return false

    return await sendPushNotification(user.fcm_token, title, body, { type })
  } catch (err) {
    console.error('Error enviando notificación a usuario:', err)
    return false
  }
}
