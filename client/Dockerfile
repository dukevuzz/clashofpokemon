# Only needed if you self-host the client. The deploy puts it on Cloudflare
# Pages instead, with the sprite atlases on the CDN, so this exists for local
# runs and for anyone who would rather serve everything from one box.
FROM node:22-alpine AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API
ARG VITE_GAME_SERVER
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /src/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
