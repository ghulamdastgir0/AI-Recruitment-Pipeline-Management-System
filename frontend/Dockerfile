FROM node:24-bookworm AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at runtime — so the backend URL has to be known before this step
# rather than passed as a normal Cloud Run env var. Override with
# --build-arg if the backend URL ever changes.
ARG NEXT_PUBLIC_API_BASE_URL=https://rms-backend-397963581210.asia-southeast1.run.app
ARG NEXT_PUBLIC_COMPANY_NAME="AI Recruitment Pipeline"
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_COMPANY_NAME=$NEXT_PUBLIC_COMPANY_NAME

RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

# Cloud Run sets PORT itself; Next's standalone server.js reads it directly.
CMD ["node", "server.js"]
