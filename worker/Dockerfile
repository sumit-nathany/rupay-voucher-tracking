# Automated RuPay Ordering Cloud Run Job container
FROM node:20-slim AS runner

WORKDIR /app

# Copy root and workspaces
COPY package*.json ./
COPY web/package*.json ./web/
COPY worker/package*.json ./worker/

# Install dependencies
RUN npm --prefix web install --omit=dev
RUN npm --prefix worker install

# Copy application sources
COPY web/src ./web/src
COPY web/tsconfig.json ./web/
COPY worker ./worker

ENV NODE_ENV=production

# Run worker
CMD ["npx", "--prefix", "worker", "tsx", "worker/src/index.ts"]
