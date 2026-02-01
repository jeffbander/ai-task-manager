FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-slim
RUN useradd -m -s /bin/bash clawhealth
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
VOLUME ["/data/registry"]
EXPOSE 3000
USER clawhealth
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/index.js"]
