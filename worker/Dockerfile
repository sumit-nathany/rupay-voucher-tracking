# Ordering worker — production container for Google Cloud Run Jobs.
#
# Two stages: a build stage that bundles the TypeScript sources, and a slim
# runtime stage that carries only the compiled bundle, the worker's runtime
# dependencies, and Playwright's Chromium with its OS libraries.
#
# The worker imports shared domain code from web/src, so the build stage needs
# those sources — but not web's node_modules, because esbuild leaves every npm
# package external and the worker declares the ones it needs.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY worker/package*.json ./worker/
RUN cd worker && npm ci

COPY worker/build.mjs worker/tsconfig.json worker/tsconfig.build.json ./worker/
COPY worker/src ./worker/src
COPY web/src ./web/src
COPY web/tsconfig.json ./web/

RUN cd worker && npm run build


# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # Profiles live in a throwaway directory: the job logs in fresh on every
    # execution and no portal session is ever persisted between runs.
    WORKER_PROFILE_DIR=/tmp/rupay-worker-profiles

WORKDIR /app/worker

COPY worker/package*.json ./
RUN npm ci --omit=dev \
    && npx playwright install --with-deps chromium \
    && rm -rf /root/.cache

COPY --from=build /app/worker/dist ./dist

# Chromium refuses to run as root without --no-sandbox; the runner adds that
# flag automatically when it detects it is running as root on Linux.

ENTRYPOINT ["node", "dist/worker.js"]
