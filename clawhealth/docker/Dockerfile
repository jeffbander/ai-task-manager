# ClawHealth ClawBox Container
#
# Adapted from OpenClaw's Dockerfile + Dockerfile.sandbox.
# Each patient gets their own container running the Gateway + Agent Runtime.
# This is the per-patient isolation model.

FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY gateway/ ./gateway/
COPY agent/ ./agent/
COPY skills/ ./skills/
RUN npx tsc

# --- Production image ---
FROM node:22-slim

# Install SQLCipher for encrypted database support
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlcipher-dev \
    && rm -rf /var/lib/apt/lists/*

# Security: run as non-root user
RUN useradd -m -s /bin/bash clawhealth
WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Health data volume — encrypted at the volume level
VOLUME ["/data"]

# Gateway port (matches OpenClaw's default 18789)
EXPOSE 18789

# Run as non-root
USER clawhealth

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:18789/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the Gateway (which spawns the Agent Runtime internally)
CMD ["node", "dist/gateway/src/index.js"]
