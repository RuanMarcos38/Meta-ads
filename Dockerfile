FROM node:20-alpine AS build

WORKDIR /app

COPY apps/api/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY apps/api/prisma ./prisma
COPY apps/api/tsconfig.json ./tsconfig.json
COPY apps/api/src ./src
COPY apps/api/scripts ./scripts

RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3333
ENV DATABASE_SCHEMA=gestao_ads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/dist ./dist

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3333) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start:production"]
