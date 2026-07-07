FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3333
ENV API_PORT=3333

COPY package.json ./
COPY server.js ./

EXPOSE 3333
EXPOSE 3000

CMD ["node", "server.js"]
