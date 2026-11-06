# Backend: Node.js 24 voert de TypeScript direct uit (geen build-stap nodig).
# Bouwen vanuit de root van de repo:  docker build -f backend/Dockerfile .

FROM node:24-slim AS deps
WORKDIR /srv
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY backend/package.json backend/
COPY portal/package.json portal/
# Alleen de runtime-afhankelijkheden van de backend
RUN npm ci --workspace backend --omit=dev --no-audit --no-fund

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=deps /srv/node_modules ./node_modules
COPY --chown=node:node backend ./backend
# Pakketten die in een andere versie nodig zijn (bijv. ajv 8 naast ajv 6 van ESLint)
# zet npm in backend/node_modules: die moeten ook mee
COPY --from=deps /srv/backend/node_modules ./backend/node_modules
WORKDIR /srv/backend
# Niet als root draaien
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Eerst nieuwe migraties uitvoeren, dan de API starten
CMD ["sh", "-c", "node scripts/migrate.ts && exec node src/server.ts"]
