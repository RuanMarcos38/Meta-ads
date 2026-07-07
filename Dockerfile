FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm install

FROM deps AS build

WORKDIR /app

COPY apps/api/prisma ./apps/api/prisma
RUN npm --workspace apps/api run prisma:generate

COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY apps/api/src ./apps/api/src
RUN npm --workspace apps/api run build

RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /app/apps/api

ENV NODE_ENV=production
ENV PORT=3333
ENV API_PORT=3333

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/scripts ./scripts
COPY --from=build /app/apps/api/dist ./dist

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npm run migrate && npm run start"]
