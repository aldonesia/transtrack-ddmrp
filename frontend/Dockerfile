FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Inlined into the browser bundle at build time (Next.js public env).
ARG NEXT_PUBLIC_API_URL=https://transtrack-ddmrp-api.skom.my.id
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Optional: "development" for local stacks (see docker-compose.dev.yml); usable in UI if needed.
ARG NEXT_PUBLIC_APP_MODE=
ENV NEXT_PUBLIC_APP_MODE=$NEXT_PUBLIC_APP_MODE

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3001

CMD ["npm", "run", "start"]
