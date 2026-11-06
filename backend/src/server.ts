// Startpunt van de backend: `npm run dev` (met herstart bij wijzigingen) of `npm start`.
import { createApp, createHttpServer } from './app.ts'
import { loadConfig } from './config.ts'
import { createPool } from './db.ts'
import { createPush } from './push.ts'
import { attachRealtime } from './realtime.ts'

const config = loadConfig()
const db = createPool(config.databaseUrl)
const push = createPush(db, config.vapid)
const { handler, deps } = createApp({ db, config, push })
const server = createHttpServer(handler)
deps.realtime = attachRealtime(server, { jwtSecret: config.jwtSecret, corsOrigins: config.corsOrigins })

// Privacy: verlopen locaties en vriendcodes elke minuut opruimen
const cleanup = setInterval(() => {
  db.query('DELETE FROM locations WHERE expires_at < now()').catch((e) => console.error('[cleanup]', e))
  db.query(`DELETE FROM friend_codes WHERE expires_at < now() - interval '1 day'`).catch((e) => console.error('[cleanup]', e))
  db.query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`).catch((e) => console.error('[cleanup]', e))
}, 60_000)

server.listen(config.port, () => {
  console.log(`Festivalapp-API draait op http://localhost:${config.port} (${config.env})`)
  if (!push.enabled) console.log('  Pushmeldingen staan uit: zet VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY in .env')
  if (!config.ai) console.log('  Chatbot gebruikt de ingebouwde FAQ: zet AI_API_KEY in .env voor een taalmodel')
})

function shutdown() {
  console.log('Afsluiten…')
  clearInterval(cleanup)
  deps.realtime.close()
  server.close(() => {
    void db.end().then(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
