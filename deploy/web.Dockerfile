# Webserver: bouwt de app en het portal en serveert ze met Caddy.
# Caddy stuurt /api (incl. WebSocket) door naar de backend.
# Bouwen vanuit de root van de repo:  docker build -f deploy/web.Dockerfile .

FROM node:24-slim AS build
WORKDIR /srv
COPY package.json package-lock.json tsconfig.base.json ./
COPY app/package.json app/
COPY backend/package.json backend/
COPY portal/package.json portal/
RUN npm ci --workspace app --workspace portal --no-audit --no-fund
COPY app ./app
COPY portal ./portal

# Publieke instellingen voor de browser (komen in de JavaScript terecht: nooit geheimen!)
ARG VITE_CARTO_KEY=""
ENV VITE_API_URL=/api \
    VITE_CARTO_KEY=${VITE_CARTO_KEY}
RUN npm run build --workspace app \
 && PORTAL_BASE=/beheer/ npm run build --workspace portal

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /srv/app/dist /srv/app
COPY --from=build /srv/portal/dist /srv/portal
