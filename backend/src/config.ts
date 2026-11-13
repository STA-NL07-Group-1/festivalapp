// Alle instellingen komen uit omgevingsvariabelen (zie ../.env.example).
// In productie stoppen we direct als er iets belangrijks ontbreekt.

export interface Config {
  env: 'development' | 'test' | 'production'
  port: number
  databaseUrl: string
  jwtSecret: Uint8Array
  accessTokenTtlSeconds: number
  refreshTokenTtlDays: number
  corsOrigins: string[]
  appUrl: string
  vapid: { publicKey: string; privateKey: string; subject: string } | null
  iotDeviceKeys: Map<string, string> // sha256(sleutel) → apparaat-id
  ai: { apiKey: string; model: string } | null
  /** Mail via Resend; null = mails alleen in de log */
  mail: { apiKey: string; from: string } | null
  festivalTimeZone: string
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Omgevingsvariabele ${name} ontbreekt`)
  return value
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV ?? 'development') as Config['env']
  const isProd = env === 'production'

  const secret = required('JWT_SECRET', isProd ? undefined : 'alleen-voor-ontwikkeling-niet-in-productie-gebruiken')
  if (isProd && secret.length < 32) throw new Error('JWT_SECRET moet minstens 32 tekens zijn')

  const vapidPublic = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY

  // IOT_DEVICE_KEYS="hoofdpodium-1:<sha256-hex>,tent-2:<sha256-hex>"
  const iotDeviceKeys = new Map<string, string>()
  for (const entry of (process.env.IOT_DEVICE_KEYS ?? '').split(',').filter(Boolean)) {
    const [deviceId, hash] = entry.split(':')
    if (deviceId && hash) iotDeviceKeys.set(hash.trim().toLowerCase(), deviceId.trim())
  }

  return {
    env,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL', isProd ? undefined : 'postgres://festivalapp:festivalapp@localhost:5432/festivalapp'),
    jwtSecret: new TextEncoder().encode(secret),
    accessTokenTtlSeconds: Math.min(Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900), 900),
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    appUrl: process.env.APP_URL ?? 'http://localhost:5173',
    vapid:
      vapidPublic && vapidPrivate
        ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: process.env.VAPID_SUBJECT ?? 'mailto:team@example.org' }
        : null,
    iotDeviceKeys,
    ai: process.env.AI_API_KEY
      ? { apiKey: process.env.AI_API_KEY, model: process.env.AI_MODEL ?? 'claude-haiku-5-5' }
      : null,
    mail: process.env.RESEND_API_KEY
      ? { apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM ?? 'Festival Buddy <no-reply@festivalbuddy.nl>' }
      : null,
    festivalTimeZone: process.env.FESTIVAL_TIME_ZONE ?? 'Europe/Amsterdam',
    ...overrides,
  }
}
