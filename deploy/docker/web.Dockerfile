# syntax=docker/dockerfile:1.7
# Neyvu / SchoolVault web (Next.js 16, standalone output).
# Build from the repository root:
#   docker build -f deploy/docker/web.Dockerfile -t neyvu-web .
# The assemble stage mirrors scripts/prepare_managed_beta.py: only the multi-user School
# code is copied, with the deploy/beta-* overlays. Owner vault routes never enter the image.
# No secrets are baked in; all SCHOOL_* values arrive at runtime (ECS secrets / env).
# deploy/Dockerfile.beta (Render) is unchanged and remains the Render build.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS assemble
WORKDIR /src
COPY app/beta ./app/beta
COPY app/api/beta ./app/api/beta
COPY app/not-found.tsx ./app/not-found.tsx
COPY lib/beta ./lib/beta
COPY lib/brand.ts ./lib/brand.ts
COPY deploy/migrations ./deploy/migrations
COPY public/brand ./public/brand
COPY public/beta-product ./public/beta-product
COPY public/beta-demo ./public/beta-demo
COPY public/citation-licenses ./public/citation-licenses
COPY public/icon-192.png public/icon-512.png ./public/
COPY proxy.ts next-env.d.ts tsconfig.json package.json package-lock.json ./
COPY scripts/migrate-beta.mjs scripts/beta_maintenance.mjs scripts/usb_delivery_text.mjs scripts/moodle_post_verifier.py ./scripts/
# Managed-beta overlays (same mapping as prepare_managed_beta.py).
COPY deploy/beta-layout.tsx ./app/layout.tsx
COPY deploy/beta-home.tsx ./app/page.tsx
COPY deploy/beta-robots.ts ./app/robots.ts
COPY deploy/beta-sitemap.ts ./app/sitemap.ts
COPY deploy/beta-next.config.ts ./next.config.ts
COPY deploy/beta-entrypoint.mjs ./beta-entrypoint.mjs

FROM ${NODE_IMAGE} AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=assemble /src ./
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=10000 \
    SCHOOL_BETA_FILE_ROOT=/var/schoolvault/files
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/beta-entrypoint.mjs ./beta-entrypoint.mjs
# Migrations ship with the image so the one-off migration task can run
# `node scripts/migrate-beta.mjs` with SCHOOL_BETA_MIGRATION_URL; the web task never has it.
COPY --from=build --chown=node:node /app/deploy/migrations ./deploy/migrations
COPY --from=build --chown=node:node /app/scripts/migrate-beta.mjs ./scripts/migrate-beta.mjs
# beta-entrypoint.mjs requires this exact mount. On Fargate it is ephemeral task
# storage unless an EFS volume is attached (see deploy/aws-ca-central-1/README.md).
RUN mkdir -p /var/schoolvault/files && chown -R node:node /var/schoolvault && chmod 700 /var/schoolvault/files
USER node
EXPOSE 10000
# Readiness returns 200 only with a restricted DB role, writable file root and current schema.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/beta/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","beta-entrypoint.mjs"]
