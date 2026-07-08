# Dockerfile raiz para EasyPanel -> aponta para apps/api
FROM node:20-alpine
WORKDIR /app
COPY apps/api/package*.json ./
RUN npm install
COPY apps/api/ .
RUN npx prisma generate && npm run build
EXPOSE 3333
CMD ["npm", "start"]
