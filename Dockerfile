# ---- build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
# Multi-arch base (works on Raspberry Pi arm64 and on x86 rented servers).
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg tzdata \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8077
WORKDIR /app
COPY --from=build /app /app
VOLUME /data
EXPOSE 8077
CMD ["node", "server/dist/index.js"]
