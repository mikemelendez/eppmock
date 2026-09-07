FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
COPY deploy/export-caddy-certs.mjs /app/export-caddy-certs.mjs

RUN mkdir -p /app/data /app/certs \
  && chmod +x /app/docker-entrypoint.sh

# 43 WHOIS, 700 public EPP/TLS, 8080 dashboard (Caddy proxies 80/443). RDAP stays on 8090 internal.
EXPOSE 43 700 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
