# ClawHealth ClawBox — Per-Patient Container
#
# Each patient gets one of these. Runs the Gateway + Clinical Agent
# in a single process. Adapted from OpenClaw's Dockerfile.sandbox.

FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 (native module)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY gateway/ ./gateway/
COPY agent/ ./agent/
COPY skills/ ./skills/

# Compile TypeScript
RUN npx tsc || true
# Also copy source for tsx fallback in dev
COPY gateway/ ./dist-src/gateway/
COPY agent/ ./dist-src/agent/

# --- Production image ---
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash clawhealth
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-src ./dist-src
COPY package.json tsconfig.json ./
COPY gateway/ ./gateway/
COPY agent/ ./agent/
COPY skills/ ./skills/

# Rebuild native modules in production image
RUN npm rebuild better-sqlite3

VOLUME ["/data"]
EXPOSE 18789

USER clawhealth

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:18789/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

# Use tsx to run TypeScript directly (simpler for POC)
CMD ["npx", "tsx", "gateway/src/index.ts"]
