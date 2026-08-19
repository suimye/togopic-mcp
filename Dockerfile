# togopic-mcp — HTTP (Streamable HTTP) server, with Chromium for PDF rendering.
# Serves the MCP endpoint on :3000 at $MCP_PATH (default /mcp).

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
# Chromium powers build_figure (PDF); fonts-noto-cjk renders Japanese text.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium \
    TOGOPIC_RETURN_BYTES=1 \
    PORT=3000 \
    MCP_PATH=/mcp
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/http.js"]
