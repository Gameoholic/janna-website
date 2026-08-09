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
  && apt-get install -y --no-install-recommends ffmpeg tzdata python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
# Голос (8D) — faster-whisper runs as a warm local process spawned by Node
# (server/src/whisper.ts), talking over 127.0.0.1 only. --break-system-packages
# is needed on Debian bookworm's PEP 668-managed Python; this container only
# ever runs this one app, so there's no system-package conflict to worry about.
COPY server/whisper_requirements.txt /app/server/whisper_requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r /app/server/whisper_requirements.txt
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8077
WORKDIR /app
COPY --from=build /app /app
VOLUME /data
EXPOSE 8077
CMD ["node", "server/dist/index.js"]
