# Tiny sidecar: git + docker CLI only, nothing else. Holds the Docker-socket
# and repo mounts so the main app never has to (see docs/SETUP.md, "Deploy
# from GitHub").
FROM node:22-alpine
RUN apk add --no-cache git docker-cli docker-cli-compose docker-cli-buildx \
  && git config --global --add safe.directory '*'
WORKDIR /app
COPY server.mjs ./
ENV PORT=8090
EXPOSE 8090
CMD ["node", "server.mjs"]
